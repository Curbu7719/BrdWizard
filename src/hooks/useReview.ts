import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { callEdgeFunction } from '../lib/sse';
import type { BrdWarning, ReviewStage } from '../types/brd';

/**
 * Drives the post-authoring review pipeline for one BRD:
 *   submit → compliance (3 lenses, synchronous + parallel) → maturity → done.
 * Both compliance and maturity now run as synchronous edge calls (no Batch API,
 * no polling). Also loads the resulting warnings and lets the user acknowledge
 * or reject them.
 */
export function useReview(brdId: string, initialStage: ReviewStage) {
  const [warnings, setWarnings] = useState<BrdWarning[]>([]);
  const [stage, setStage] = useState<ReviewStage>(initialStage);
  const [busy, setBusy] = useState(false);
  // Guards the maturity auto-resume so it fires at most once per mount.
  const maturityResumedRef = useRef(false);
  // Guards the compliance auto-resume so it fires at most once per mount.
  const complianceResumedRef = useRef(false);
  // Aborts the in-flight review request when the user cancels.
  const abortRef = useRef<AbortController | null>(null);
  // Set true by cancelReview so the chain stops advancing the stage.
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

  const runMaturity = useCallback(async () => {
    setStage('maturity_running');
    const { data } = await callEdgeFunction<{ review_stage: ReviewStage }>(
      'maturity-check',
      { brd_id: brdId },
      abortRef.current?.signal,
    );
    if (cancelledRef.current) return;
    if (data?.review_stage) setStage(data.review_stage);
    await loadWarnings();
  }, [brdId, loadWarnings]);

  // Run the synchronous compliance review (3 lenses in parallel server-side),
  // then chain into maturity. Surfaces an error without advancing on failure.
  const runCompliance = useCallback(async () => {
    cancelledRef.current = false;
    abortRef.current = new AbortController();
    setStage('compliance_running');
    const { data, error } = await callEdgeFunction<{ review_stage: ReviewStage }>(
      'compliance-submit',
      { brd_id: brdId },
      abortRef.current.signal,
    );
    // Cancelled mid-flight — cancelReview already reset the stage; stay quiet.
    if (cancelledRef.current) return { error: null };
    if (error || data?.review_stage !== 'compliance_done') {
      // compliance-submit rolled the stage back to 'none' on total failure.
      setStage('none');
      return { error: error ?? 'Compliance review failed' };
    }
    setStage('compliance_done');
    await loadWarnings();
    if (cancelledRef.current) return { error: null };
    await runMaturity();
    return { error: null };
  }, [brdId, loadWarnings, runMaturity]);

  // Resume a compliance step left mid-flight. Compliance runs as a single
  // synchronous edge call now; if the user navigated away while it was running,
  // the BRD is left at 'compliance_running' with no one to finish it. Re-run it
  // once on load — compliance-submit clears and re-inserts, so it is idempotent.
  useEffect(() => {
    if (initialStage === 'compliance_running' && !complianceResumedRef.current) {
      complianceResumedRef.current = true;
      void runCompliance();
    }
  }, [initialStage, runCompliance]);

  // Resume a stuck maturity step. Maturity runs as a single synchronous edge
  // call (no polling), so if the user navigated away while it was mid-flight the
  // BRD can be left at 'maturity_running' with no one to finish it. When we load
  // a BRD already in that state, re-run maturity once — the edge function
  // replaces maturity findings, so re-running is safe (idempotent end state).
  useEffect(() => {
    if (initialStage === 'maturity_running' && !maturityResumedRef.current) {
      maturityResumedRef.current = true;
      void runMaturity();
    }
  }, [initialStage, runMaturity]);

  const submitForReview = useCallback(async () => {
    setBusy(true);
    // Fresh run — drop any previously-loaded warnings from the UI.
    setWarnings([]);
    const { error } = await runCompliance();
    setBusy(false);
    return { error };
  }, [runCompliance]);

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
