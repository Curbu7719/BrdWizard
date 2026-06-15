/**
 * Shared helpers for the post-authoring review pipeline (compliance + maturity).
 *
 * - buildReviewText(): renders the full BRD as plain text with STABLE identifiers
 *   (section_key for sections, story_id for user stories) so a reviewing agent can
 *   reference exactly which item a warning applies to.
 * - OUTPUT_FORMAT_INSTRUCTIONS: the FIXED JSON contract appended by the edge
 *   functions (NOT admin-editable) so warning parsing stays robust regardless of
 *   how the admin edits a reviewer prompt.
 * - parseWarnings(): tolerant extraction + validation of the agent's JSON output.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface ReviewSectionRow {
  section_key: string;
  section_title: string;
  sort_order: number;
  content_full: string | null;
}

export interface ReviewEpicRow {
  id: string;
  title: string;
  description: string | null;
  sort_order: number;
}

export interface ReviewStoryRow {
  id: string;
  epic_id: string;
  full_text: string;
  sort_order: number;
}

export interface ReviewBrdRow {
  title: string;
  product_type: string;
  mobility_type: string;
  change_type: string;
  impacted_channels: string[];
}

/** A warning as parsed from the agent and ready to insert into brd_warnings. */
export interface ParsedWarning {
  target_type: 'section' | 'story' | 'brd';
  target_section_key: string | null;
  target_story_id: string | null;
  severity: string;
  message: string;
  recommendation: string | null;
}

/** Load the sections, epics, and stories needed to review a BRD. */
export async function loadReviewContent(
  db: SupabaseClient,
  brdId: string,
): Promise<{ sections: ReviewSectionRow[]; epics: ReviewEpicRow[]; stories: ReviewStoryRow[] }> {
  const [secRes, epicRes, storyRes] = await Promise.all([
    db.from('brd_sections').select('section_key, section_title, sort_order, content_full').eq('brd_id', brdId).order('sort_order'),
    db.from('epics').select('id, title, description, sort_order').eq('brd_id', brdId).order('sort_order'),
    db.from('user_stories').select('id, epic_id, full_text, sort_order').eq('brd_id', brdId).order('sort_order'),
  ]);
  return {
    sections: (secRes.data ?? []) as ReviewSectionRow[],
    epics: (epicRes.data ?? []) as ReviewEpicRow[],
    stories: (storyRes.data ?? []) as ReviewStoryRow[],
  };
}

/**
 * Render the BRD as review text. Every section is labelled with its section_key
 * and every story with its story_id so the reviewer can target items precisely.
 */
export function buildReviewText(
  brd: ReviewBrdRow,
  sections: ReviewSectionRow[],
  epics: ReviewEpicRow[],
  stories: ReviewStoryRow[],
): string {
  const lines: string[] = [];
  lines.push(`# BRD: ${brd.title}`);
  lines.push(
    `Classification: product=${brd.product_type}, mobility=${brd.mobility_type}, change=${brd.change_type}, channels=${(brd.impacted_channels ?? []).join(', ') || 'none'}`,
  );
  lines.push('');

  const named = sections
    .filter((s) => s.section_key !== 'epics_overview')
    .sort((a, b) => a.sort_order - b.sort_order);
  for (const s of named) {
    lines.push(`## Section: ${s.section_title} (section_key: ${s.section_key})`);
    lines.push(s.content_full?.trim() || '(empty)');
    lines.push('');
  }

  const epicsOverview = sections.find((s) => s.section_key === 'epics_overview');
  lines.push('## Section: Epics Overview (section_key: epics_overview)');
  if (epicsOverview?.content_full?.trim()) lines.push(epicsOverview.content_full.trim());
  lines.push('');

  const sortedEpics = [...epics].sort((a, b) => a.sort_order - b.sort_order);
  for (const epic of sortedEpics) {
    lines.push(`### Epic: ${epic.title}`);
    if (epic.description?.trim()) lines.push(epic.description.trim());
    const epicStories = stories
      .filter((st) => st.epic_id === epic.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (epicStories.length === 0) {
      lines.push('(no user stories)');
    } else {
      for (const st of epicStories) {
        lines.push(`- Story [story_id: ${st.id}]:`);
        for (const l of (st.full_text ?? '').split('\n')) {
          if (l.trim()) lines.push(`    ${l.trim()}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * The FIXED output contract. Appended to the user message by the edge function.
 * `validIds` lists the section keys and story ids the agent may target.
 */
export function outputFormatInstructions(
  validSectionKeys: string[],
  validStoryIds: string[],
): string {
  return [
    '',
    '---',
    'OUTPUT FORMAT — respond with ONLY a single JSON object, no prose, no markdown fences:',
    '{"warnings":[',
    '  {"target_type":"section","section_key":"<one of the section keys>","severity":"warning","message":"...","recommendation":"..."},',
    '  {"target_type":"story","story_id":"<one of the story ids>","severity":"critical","message":"...","recommendation":"..."}',
    ']}',
    '',
    'Rules:',
    '- target_type is "section", "story", or "brd" (use "brd" only for an issue that spans the whole document).',
    '- For target_type "section", set section_key to EXACTLY one of these: ' + (validSectionKeys.join(', ') || '(none)') + '.',
    '- For target_type "story", set story_id to EXACTLY one of these UUIDs: ' + (validStoryIds.join(', ') || '(none)') + '.',
    '- severity is one of: info, warning, critical (for maturity you may also use: contradiction, unclear).',
    '- message and recommendation are plain text in the BRD content language.',
    '- If there are no issues, return {"warnings":[]}.',
    '- Do NOT include any text before or after the JSON object.',
  ].join('\n');
}

/**
 * Tolerantly parse the agent's response into validated warnings.
 * Accepts raw JSON, JSON wrapped in ```json fences, or JSON with surrounding prose.
 * Returns [] on any failure (never throws).
 */
export function parseWarnings(
  text: string,
  validSectionKeys: Set<string>,
  validStoryIds: Set<string>,
): ParsedWarning[] {
  if (!text) return [];

  // Find the first '{' and last '}' to tolerate fences/prose around the JSON.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];

  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const rawList = (obj as { warnings?: unknown })?.warnings;
  if (!Array.isArray(rawList)) return [];

  const out: ParsedWarning[] = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;

    const message = typeof r.message === 'string' ? r.message.trim() : '';
    if (!message) continue;

    let targetType = typeof r.target_type === 'string' ? r.target_type : 'brd';
    let sectionKey: string | null =
      typeof r.section_key === 'string' ? r.section_key : null;
    let storyId: string | null =
      typeof r.story_id === 'string' ? r.story_id : null;

    // Validate references; drop unknown ids by downgrading to a BRD-level note.
    if (targetType === 'section') {
      if (!sectionKey || !validSectionKeys.has(sectionKey)) {
        targetType = 'brd';
        sectionKey = null;
      }
      storyId = null;
    } else if (targetType === 'story') {
      if (!storyId || !validStoryIds.has(storyId)) {
        targetType = 'brd';
        storyId = null;
      }
      sectionKey = null;
    } else {
      targetType = 'brd';
      sectionKey = null;
      storyId = null;
    }

    const severity =
      typeof r.severity === 'string' && r.severity.trim() ? r.severity.trim() : 'warning';
    const recommendation =
      typeof r.recommendation === 'string' && r.recommendation.trim()
        ? r.recommendation.trim()
        : null;

    out.push({
      target_type: targetType as ParsedWarning['target_type'],
      target_section_key: sectionKey,
      target_story_id: storyId,
      severity,
      message,
      recommendation,
    });
  }
  return out;
}
