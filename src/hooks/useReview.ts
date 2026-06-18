import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { callEdgeFunction } from '../lib/sse';
import type { BrdWarning, ReviewStage } from '../types/brd';

/**
 * Drives the post-authoring review pipeline for one BRD:
 *   submit → compliance (Batch API, polled) → maturity (synchronous) → done.
 * Also loads the resulting warnings and lets the user acknowledge them.
 */
export function useReview(brdId: string, initialStage: ReviewStage) {
  const [warnings, setWarnings] = useState<BrdWarning[]>([]);
  const [stage, setStage] = useState<ReviewStage>(initialStage);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);
  // Guards the maturity auto-resume so it fires at most once per mount.
  const maturityResumedRef = useRef(false);

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
    );
    if (data?.review_stage) setStage(data.review_stage);
    await loadWarnings();
  }, [brdId, loadWarnings]);

  // Poll the compliance batch while it is running; chain into maturity when done.
  useEffect(() => {
    if (stage !== 'compliance_running') return;
    let cancelled = false;

    async function tick() {
      const { data } = await callEdgeFunction<{ review_stage: ReviewStage }>(
        'review-status',
        { brd_id: brdId },
      );
      if (cancelled) return;
      if (data?.review_stage === 'compliance_done') {
        await loadWarnings();
        await runMaturity();
        return;
      }
      timerRef.current = window.setTimeout(tick, 8000);
    }

    timerRef.current = window.setTimeout(tick, 4000);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [stage, brdId, loadWarnings, runMaturity]);

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
    const { data, error } = await callEdgeFunction<{ review_stage: ReviewStage }>(
      'compliance-submit',
      { brd_id: brdId },
    );
    setBusy(false);
    if (!error && data?.review_stage) {
      setStage(data.review_stage);
      // Fresh run — drop any previously-loaded warnings from the UI.
      setWarnings([]);
    }
    return { error };
  }, [brdId]);

  const acknowledge = useCallback(async (id: string) => {
    await supabase.from('brd_warnings').update({ status: 'acknowledged' }).eq('id', id);
    setWarnings(prev => prev.map(w => (w.id === id ? { ...w, status: 'acknowledged' } : w)));
  }, []);

  const openCount = warnings.filter(w => w.status === 'open').length;

  return { warnings, stage, busy, openCount, submitForReview, acknowledge, reload: loadWarnings };
}
