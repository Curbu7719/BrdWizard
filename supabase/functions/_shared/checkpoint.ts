/**
 * Checkpoint & handoff package logic — ARCHITECTURE.md §5.3, §5.4
 *
 * Responsibilities:
 *   - handleContextThresholds(): evaluate context_token_pct and take action.
 *   - generateHandoffPackage(): call LLM to produce a structured handoff JSON.
 *   - autoCheckpointActiveSection(): summarise + save the active section at 85%.
 *
 * Thresholds (from ADR-0001, now runtime-configurable via ADMIN-CONFIG.md §2):
 *   >= warn_pct (default 70%)  → warn client (no automatic action)
 *   >= checkpoint_pct (def 85%) → auto-checkpoint the active section
 *   >= handoff_pct (def 90%)   → generate handoff package for next session
 *
 * Callers (llm-stream) pass a ThresholdSettings object loaded from getSettings().
 * The hardcoded constant below is kept only as documentation of the original default.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { LLMProvider } from './llm/types.ts';
import type { BrdSection, BrdDocument, HandoffPackage } from './context-builder.ts';

/**
 * Threshold configuration passed in by callers.
 * All values are loaded from app_settings (or fall back to these defaults).
 */
export interface ThresholdSettings {
  /** Model context window in tokens (default 200_000). */
  contextWindowTokens: number;
  /** Percentage at which to warn the user (default 70). */
  warnPct: number;
  /** Percentage at which to auto-checkpoint the section (default 85). */
  checkpointPct: number;
  /** Percentage at which to generate a handoff package (default 90). */
  handoffPct: number;
}

/** Default thresholds matching historical hardcoded values. */
export const DEFAULT_THRESHOLD_SETTINGS: ThresholdSettings = {
  contextWindowTokens: 200_000,
  warnPct: 70,
  checkpointPct: 85,
  handoffPct: 90,
};

/** Section order used to determine the "next section" after a checkpoint. */
const SECTION_ORDER = ['background', 'objective', 'epics_overview'];

/**
 * Compute context percentage from token counts.
 *
 * @param inputTokens   - Input token count for this turn.
 * @param windowTokens  - Context window size; defaults to 200_000 if not supplied.
 */
export function computeContextPct(inputTokens: number, windowTokens = 200_000): number {
  return Math.min(100, Math.round((inputTokens / windowTokens) * 100));
}

/**
 * Update brd_documents.context_token_pct in DB.
 */
async function updateContextPct(
  db: SupabaseClient,
  brdId: string,
  pct: number,
): Promise<void> {
  await db
    .from('brd_documents')
    .update({ context_token_pct: pct, updated_at: new Date().toISOString() })
    .eq('id', brdId);
}

/**
 * Generate the next section key given the current active section.
 * Falls back to the last known section key if already at the end.
 */
function nextSectionKey(currentSection: string | null): string {
  if (!currentSection) return SECTION_ORDER[0];
  const idx = SECTION_ORDER.indexOf(currentSection);
  if (idx === -1 || idx === SECTION_ORDER.length - 1) return currentSection;
  return SECTION_ORDER[idx + 1];
}

/**
 * Auto-checkpoint the active section at the 85% threshold.
 * Generates a one-line summary using the LLM and saves it to brd_sections.
 */
async function autoCheckpointActiveSection(
  db: SupabaseClient,
  llm: LLMProvider,
  brd: BrdDocument,
  sections: BrdSection[],
): Promise<void> {
  const activeKey = brd.active_section;
  if (!activeKey) return;

  const activeSection = sections.find((s) => s.section_key === activeKey);
  if (!activeSection || activeSection.status === 'approved') return;

  // Use whatever content exists in the section as the content_full.
  const contentToApprove = activeSection.content_full ?? '[Section content not yet written — auto-checkpointed due to context limit]';

  // Generate a one-line summary.
  const summaryResult = await llm.complete(
    [
      {
        role: 'user',
        content: `Summarise the following BRD section in a single line (max 20 words), suitable for use as a context breadcrumb. Format: "${activeSection.section_title}: [summary]"\n\nSection content:\n${contentToApprove}`,
      },
    ],
    { maxTokens: 100 },
  );

  const summaryLine = summaryResult.text.trim();
  const nextActive = nextSectionKey(activeKey);

  // Update brd_sections.
  await db
    .from('brd_sections')
    .upsert({
      brd_id: brd.id,
      section_key: activeKey,
      section_title: activeSection.section_title,
      sort_order: activeSection.sort_order,
      content_full: contentToApprove,
      summary_line: summaryLine,
      status: 'approved',
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brd_id,section_key' });

  // Advance active section.
  await db
    .from('brd_documents')
    .update({ active_section: nextActive, updated_at: new Date().toISOString() })
    .eq('id', brd.id);
}

/**
 * Generate the handoff package for a session transition at >= 90% context.
 * Makes a non-streaming LLM call to produce structured JSON.
 */
async function generateHandoffPackage(
  db: SupabaseClient,
  llm: LLMProvider,
  brd: BrdDocument,
  sections: BrdSection[],
): Promise<HandoffPackage> {
  const approvedSections = sections
    .filter((s) => s.status === 'approved')
    .sort((a, b) => a.sort_order - b.sort_order);

  const activeSection = sections.find((s) => s.section_key === brd.active_section);

  const prompt = `You are generating a session handoff package for a BRD authoring session.
The context window is nearly full. Produce a JSON handoff package so the next session can resume seamlessly.

BRD Title: ${brd.title}
Active section: ${brd.active_section ?? 'unknown'}
Completed sections: ${approvedSections.map((s) => s.section_key).join(', ') || 'none'}

Active section content so far:
${activeSection?.content_full ?? '(no content saved yet)'}

Approved section summaries:
${approvedSections.map((s) => `- ${s.summary_line}`).join('\n') || '(none)'}

Respond with ONLY a JSON object in this exact shape (no markdown, no explanation):
{
  "completedSections": [{"key": "...", "title": "...", "summaryLine": "..."}],
  "activeSection": "...",
  "partialWork": "...",
  "nextStep": "...",
  "openQuestions": ["..."],
  "generatedAt": "${new Date().toISOString()}"
}`;

  const result = await llm.complete(
    [{ role: 'user', content: prompt }],
    { maxTokens: 1000, temperature: 0 },
  );

  let pkg: HandoffPackage;
  try {
    pkg = JSON.parse(result.text) as HandoffPackage;
  } catch {
    // Fallback: build a minimal package from what we know.
    pkg = {
      completedSections: approvedSections.map((s) => ({
        key: s.section_key,
        title: s.section_title,
        summaryLine: s.summary_line ?? '',
      })),
      activeSection: brd.active_section ?? 'background',
      partialWork: activeSection?.content_full ?? '',
      nextStep: `Continue with ${brd.active_section ?? 'background'} section`,
      openQuestions: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Persist to DB.
  await db
    .from('brd_documents')
    .update({
      handoff_package: pkg,
      updated_at: new Date().toISOString(),
    })
    .eq('id', brd.id);

  return pkg;
}

// ---------------------------------------------------------------------------
// Main export: threshold handler
// ---------------------------------------------------------------------------

export type ThresholdAction = 'none' | 'warn' | 'checkpoint' | 'handoff';

export interface ThresholdResult {
  action: ThresholdAction;
  contextPct: number;
  handoffPackage?: HandoffPackage;
}

/**
 * Evaluates context thresholds and takes the appropriate action.
 * Called by /llm-stream after each turn completes.
 *
 * @param db          - Service-role Supabase client.
 * @param llm         - LLM provider instance (for summaries / handoff generation).
 * @param brd         - Current BRD document row.
 * @param sections    - All sections for this BRD.
 * @param inputTokens - Input token count from the just-completed turn.
 * @param thresholds  - Runtime threshold settings; defaults to historical constants.
 */
export async function handleContextThresholds(
  db: SupabaseClient,
  llm: LLMProvider,
  brd: BrdDocument,
  sections: BrdSection[],
  inputTokens: number,
  thresholds: ThresholdSettings = DEFAULT_THRESHOLD_SETTINGS,
): Promise<ThresholdResult> {
  const pct = computeContextPct(inputTokens, thresholds.contextWindowTokens);

  // Always persist the latest token percentage.
  await updateContextPct(db, brd.id, pct);

  if (pct >= thresholds.handoffPct) {
    const pkg = await generateHandoffPackage(db, llm, brd, sections);
    return { action: 'handoff', contextPct: pct, handoffPackage: pkg };
  }

  if (pct >= thresholds.checkpointPct) {
    await autoCheckpointActiveSection(db, llm, brd, sections);
    return { action: 'checkpoint', contextPct: pct };
  }

  if (pct >= thresholds.warnPct) {
    // Warn only — no automatic action per ADR-0001.
    return { action: 'warn', contextPct: pct };
  }

  return { action: 'none', contextPct: pct };
}
