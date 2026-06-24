import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { callEdgeFunction } from '../lib/sse';
import type { BrdWarning, ReviewStage } from '../types/brd';

/**
 * Drives the post-authoring review pipeline for one BRD. Compliance (3 lenses)
 * and maturity are independent, so they run as CONCURRENT synchronous edge calls
 * (no Batch API, no polling) — total time is the slower of the two, not their
 * sum. While they run, review_stage stays 'compliance_running' (the single
 * combined phase); the client advances it to 'maturity_done' once both finish.
 * Also loads the resulting warnings and lets the user acknowledge or reject them.
 */
export function useReview(brdId: string, initialStage: ReviewStage) {
  const [warnings, setWarnings] = useState<BrdWarning[]>([]);
  const [stage, setStage] = useState<ReviewStage>(initialStage);
  const [busy, setBusy] = useState(false);
  // Guards the auto-resume so it fires at most once per mount.
  const resumedRef = useRef(false);
  // Aborts the in-flight review requests when the user cancels.
  const abortRef = useRef<AbortController | null>(null);
  // Set true by cancelReview so the run stops advancing the stage.
  const cancelledRef = useRef(false);

  const loadWarnings = useCallback(async () => {
    const { data } = await supabase
      .from('brd_warnings')
      .select('*')
      .eq('brd_id', brdId)
      .order('created_at', { ascending: true });
    if (data) setWarnings(data as BrdWarning[]);
  }, [brdId]);

  useEffect(() => { void loadWarnings(); }, [loadWarnings]);

  // Re-seed local stage when the BRD row (re)loads.
  useEffect(() => { setStage(initialStage); }, [initialStage]);

  // Run compliance and maturity CONCURRENTLY. Both are stateless workers that
  // only insert findings; the client owns review_stage. We arm the cancel gate
  // by persisting 'compliance_running' first, then fire both, then advance to
  // 'maturity_done' once both settle (unless cancelled or both failed).
  const runReview = useCallback(async () => {
    cancelledRef.current = false;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setStage('compliance_running');
    const { error: stageErr } = await supabase
      .from('brd_documents')
      .update({
        review_stage: 'compliance_running',
        compliance_batch_id: null,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', brdId);
    if (stageErr) { setStage('none'); return { error: stageErr.message }; }

    const [comp, mat] = await Promise.all([
      callEdgeFunction<{ inserted?: number; cancelled?: boolean }>('compliance-submit', { brd_id: brdId }, signal),
      callEdgeFunction<{ inserted?: number; cancelled?: boolean }>('maturity-check', { brd_id: brdId }, signal),
    ]);

    // Cancelled mid-flight — cancelReview already reset the stage; stay quiet.
    if (cancelledRef.current) return { error: null };

    // Both workers failed — nothing to show; reset so the user can retry.
    if (comp.error && mat.error) {
      setStage('none');
      await supabase
        .from('brd_documents')
        .update({ review_stage: 'none', updated_at: new Date().toISOString() })
        .eq('id', brdId);
      return { error: comp.error ?? mat.error };
    }

    // Done — mark terminal and load whatever findings landed.
    await supabase
      .from('brd_documents')
      .update({ review_stage: 'maturity_done', updated_at: new Date().toISOString() })
      .eq('id', brdId);
    setStage('maturity_done');
    await loadWarnings();
    return { error: null };
  }, [brdId, loadWarnings]);

  // Resume a review left mid-flight. If the user navigated away while it ran, the
  // BRD is left at 'compliance_running' with no one to finish it. Re-run once on
  // load — the workers clear and re-insert their findings, so it is idempotent.
  useEffect(() => {
    if (initialStage === 'compliance_running' && !resumedRef.current) {
      resumedRef.current = true;
      void runReview();
    }
  }, [initialStage, runReview]);

  const submitForReview = useCallback(async () => {
    setBusy(true);
    // Fresh run — drop any previously-loaded warnings from the UI.
    setWarnings([]);
    const { error } = await runReview();
    setBusy(false);
    return { error };
  }, [runReview]);

  // Cancel an in-progress review. Aborts the in-flight request and resets the
  // persisted stage to 'none' so the BRD isn't left mid-review. The edge
  // functions re-check review_stage before writing, so a server call that is
  // still running discards its results instead of advancing the stage.
  const cancelReview = useCallback(async () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    await supabase
      .from('brd_documents')
      .update({ review_stage: 'none', compliance_batch_id: null, updated_at: new Date().toISOString() })
      .eq('id', brdId);
    // Discard any partial findings from the cancelled run.
    await supabase.from('brd_warnings').delete().eq('brd_id', brdId);
    setWarnings([]);
    setStage('none');
    setBusy(false);
  }, [brdId]);

  const acknowledge = useCallback(async (id: string) => {
    await supabase.from('brd_warnings').update({ status: 'acknowledged' }).eq('id', id);
    setWarnings(prev => prev.map(w => (w.id === id ? { ...w, status: 'acknowledged' } : w)));
  }, []);

  // Reject a finding: the user declines the recommendation. It is recorded as
  // 'rejected' and listed in a "Rejected Findings" section of the exported BRD.
  const reject = useCallback(async (id: string) => {
    await supabase.from('brd_warnings').update({ status: 'rejected' }).eq('id', id);
    setWarnings(prev => prev.map(w => (w.id === id ? { ...w, status: 'rejected' } : w)));
  }, []);

  const openCount = warnings.filter(w => w.status === 'open').length;

  return { warnings, stage, busy, openCount, submitForReview, cancelReview, acknowledge, reject, reload: loadWarnings };
}
