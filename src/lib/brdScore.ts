import type { BrdDocument, BrdSection, Epic, UserStory, BrdWarning } from '../types/brd';

export interface ScoreBreakdownItem {
  label: string;
  earned: number;
  max: number;
  detail: string;
}

export interface BrdScore {
  score: number; // 0-100, rounded
  breakdown: ScoreBreakdownItem[];
  reviewed: boolean;
}

const CANONICAL_SECTIONS = ['background', 'objective', 'epics_overview'];

/** A story counts as "detailed" if it carries acceptance criteria. */
function isDetailed(story: UserStory): boolean {
  const t = story.full_text ?? '';
  if (/acceptance criteria/i.test(t) || /kabul kriter/i.test(t)) return true;
  return t.split('\n').filter(l => l.trim().length > 0).length >= 3;
}

/**
 * Compute a 0-100 readiness score for a BRD from three pillars:
 *   1. Sections & fields completeness (25)
 *   2. Detail / coverage of epics & stories (35)
 *   3. Open review findings (40)
 *
 * Pure and deterministic — recomputed every time the user presses Generate, so
 * closing gaps and pressing again yields a higher score.
 */
export function computeBrdScore(args: {
  brd: BrdDocument;
  sections: BrdSection[];
  epics: Epic[];
  stories: UserStory[];
  warnings: BrdWarning[];
}): BrdScore {
  const { brd, sections, epics, stories, warnings } = args;

  // ── Pillar 1: Sections & fields (25) ──────────────────────────────────────
  const approvedCanonical = CANONICAL_SECTIONS.filter(key =>
    sections.some(s => s.section_key === key && s.status === 'approved'),
  ).length;
  const sectionsPts = (approvedCanonical / CANONICAL_SECTIONS.length) * 15;

  const classificationSet =
    brd.product_type !== 'unknown' && (brd.impacted_channels?.length ?? 0) > 0;
  const fieldsPts =
    (brd.expected_value?.trim() ? 5 : 0) +
    (brd.reports?.trim() ? 3 : 0) +
    (classificationSet ? 2 : 0);
  const pillar1 = sectionsPts + fieldsPts;

  // ── Pillar 2: Detail / coverage (35) ──────────────────────────────────────
  const hasEpics = epics.length > 0;
  const epicPresencePts = hasEpics ? 5 : 0;

  const epicsWithStories = hasEpics
    ? epics.filter(e => stories.some(s => s.epic_id === e.id)).length
    : 0;
  const epicCoveragePts = hasEpics ? (epicsWithStories / epics.length) * 10 : 0;

  const detailedStories = stories.filter(isDetailed).length;
  const storyDetailPts = stories.length > 0 ? (detailedStories / stories.length) * 20 : 0;
  const pillar2 = epicPresencePts + epicCoveragePts + storyDetailPts;

  // ── Pillar 3: Open review findings (40) ───────────────────────────────────
  const open = warnings.filter(w => w.status === 'open');
  let deduction = 0;
  for (const w of open) {
    const s = w.severity.toLowerCase();
    if (s === 'critical' || s === 'contradiction') deduction += 6;
    else if (s === 'info') deduction += 2;
    else deduction += 4; // warning, unclear, default
  }
  // "Reviewed" = the compliance review has produced findings (compliance_done
  // onward), not strictly maturity_done. Once findings exist, acknowledging /
  // resolving them must be able to raise this pillar — otherwise the user
  // engages with the review but the score stays pinned at the cap.
  const reviewed =
    brd.review_stage === 'compliance_done' ||
    brd.review_stage === 'maturity_running' ||
    brd.review_stage === 'maturity_done';
  let pillar3 = Math.max(0, 40 - deduction);
  // Review never ran → compliance findings are unknown, so withhold most of this
  // pillar to reward actually running the review. Capped hard (14/40) so a full
  // but unreviewed BRD can't reach a confident "ready" score on completeness alone.
  if (!reviewed) pillar3 = Math.min(pillar3, 14);

  const total = Math.round(Math.max(0, Math.min(100, pillar1 + pillar2 + pillar3)));

  return {
    score: total,
    reviewed,
    breakdown: [
      {
        label: 'Sections & fields',
        earned: Math.round(pillar1),
        max: 25,
        detail: `${approvedCanonical}/${CANONICAL_SECTIONS.length} sections approved; Expected Value ${brd.expected_value?.trim() ? '✓' : '—'}, Reports ${brd.reports?.trim() ? '✓' : '—'}`,
      },
      {
        label: 'Detail & coverage',
        earned: Math.round(pillar2),
        max: 35,
        detail: `${epicsWithStories}/${epics.length || 0} epics with stories; ${detailedStories}/${stories.length || 0} stories have acceptance criteria`,
      },
      {
        label: 'Open review findings',
        earned: Math.round(pillar3),
        max: 40,
        detail: reviewed
          ? `${open.length} open finding(s)`
          : 'Review not run yet (capped — run Submit for Review)',
      },
    ],
  };
}

export const RECOMMENDED_SCORE = 70;
