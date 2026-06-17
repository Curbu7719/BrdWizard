/**
 * Context builder — ARCHITECTURE.md §5.2
 * Assembles the full context package (system prompt + messages array) for each
 * call to /llm-stream. Reads prompt files from disk at cold start.
 *
 * Assembly order:
 *   PLATFORM_LAYER + AGENT_LAYER (with channel mapping injected)
 *   + approved section summary lines
 *   + <session_resume> block if a handoff package exists
 *   + active section header
 */

import type { ChatMessage } from './llm/types.ts';
import type { ActivePrompts } from './settings.ts';

// Prompts are imported from a generated .ts module. The Supabase Edge bundler
// supports neither runtime Deno.readTextFileSync on a dynamic path (the .md
// files would be missing → every call 500s before the stream) nor text-import
// attributes. So the .md files (editable source of truth) are embedded into
// prompts/index.ts via scripts/gen-prompts.mjs — regenerate after editing .md.
//
// These embedded constants serve as the compile-time fallback when the DB
// prompt_versions table is unavailable or the caller does not supply prompts.
import {
  platformLayerText,
  agentSkillText,
  channelMappingText,
} from './prompts/index.ts';

// ---------------------------------------------------------------------------
// Types (mirrors ARCHITECTURE.md §5.2 + brd.ts)
// ---------------------------------------------------------------------------

export interface BrdDocument {
  id: string;
  title: string;
  business_line: string;
  product_type: string;
  mobility_type: string;
  change_type: string;
  impacted_channels: string[];
  active_section: string | null;
  context_token_pct: number;
  handoff_package: HandoffPackage | null;
  /** Consolidated reference summary from /analyze-document, persisted by the frontend. */
  source_summary: string | null;
  /** User-authored expected business value — entered in setup, injected as context. */
  expected_value: string | null;
}

export interface BrdSection {
  id: string;
  section_key: string;
  section_title: string;
  sort_order: number;
  content_full: string | null;
  summary_line: string | null;
  status: 'pending' | 'in_progress' | 'approved';
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface HandoffPackage {
  completedSections: { key: string; title: string; summaryLine: string }[];
  activeSection: string;
  partialWork: string;
  nextStep: string;
  openQuestions: string[];
  generatedAt: string;
}

export interface ContextPackage {
  systemPrompt: string;
  messages: ChatMessage[];
}

/** Minimal epic shape needed by context-builder (id, title, sort_order). */
export interface EpicRow {
  id: string;
  title: string;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Current Task directive — section metadata for the "one section at a time" rule
// ---------------------------------------------------------------------------

/**
 * Human-readable label and one-line purpose for each canonical interview section.
 * Used to inject a prominent "## Current Task" block into the system prompt so the
 * model always knows which section it must work on and exactly which key to emit.
 */
const SECTION_DIRECTIVE_MAP: Record<
  string,
  { label: string; purpose: string }
> = {
  background: {
    label: 'Background',
    purpose:
      'Background = why this project exists (current situation, problem/opportunity, business driver, cost of inaction).',
  },
  objective: {
    label: 'Objective',
    purpose:
      'Objective = what the project will deliver (what will be built/changed, success criteria, explicit out-of-scope items).',
  },
  epics_overview: {
    label: 'Epics Overview',
    purpose:
      'Epics Overview = the high-level epic list agreed before writing user stories (propose epics, get approval before proceeding).',
  },
};

// ---------------------------------------------------------------------------
// Prompt resolution helpers
// ---------------------------------------------------------------------------

/**
 * Returns the platform layer text.
 * Prefers the DB-sourced version when supplied, falls back to the embedded constant.
 */
function getPlatformLayer(prompts?: ActivePrompts): string {
  return prompts?.platform_layer ?? platformLayerText;
}

/**
 * Returns the fully assembled Agent Layer string with channel mapping injected.
 * Prefers DB-sourced texts when supplied, falls back to embedded constants.
 */
function assembleAgentLayer(prompts?: ActivePrompts): string {
  const agentText    = prompts?.agent_skill     ?? agentSkillText;
  const channelText  = prompts?.channel_mapping ?? channelMappingText;
  // The {{CHANNEL_MAPPING}} placeholder is OPTIONAL: if present, substitute the
  // channel mapping in place; if the author omitted it, append the mapping at the
  // end so it is always injected and an edited agent-skill can never silently
  // drop it (and saving never fails for a missing token).
  return agentText.includes('{{CHANNEL_MAPPING}}')
    ? agentText.replace('{{CHANNEL_MAPPING}}', channelText)
    : `${agentText}\n\n## Channel-to-Domain Mapping\n\n${channelText}`;
}

// ---------------------------------------------------------------------------
// Context package builder
// ---------------------------------------------------------------------------

/**
 * Builds the full context package for a single /llm-stream call.
 *
 * @param brd         - The BRD document row.
 * @param sections    - All sections for this BRD (all statuses).
 * @param activeTurns - conversation_turns for the active section only (full history).
 * @param userMessage - The new user message being submitted this turn.
 * @param epics       - All epic rows for this BRD (loaded by llm-stream for story phases).
 * @param prompts     - Active prompt texts loaded from DB (via getPrompts()).
 *                      Falls back to the embedded constants if not supplied or
 *                      if a specific key is missing — keeping behaviour identical
 *                      to pre-parametrization when the migration hasn't run yet.
 */
export function buildContextPackage(
  brd: BrdDocument,
  sections: BrdSection[],
  activeTurns: ConversationTurn[],
  userMessage: string,
  epics: EpicRow[] = [],
  prompts?: ActivePrompts,
): ContextPackage {
  // 1. Approved sections → summary lines (minimal token cost) for most sections.
  //    Exception: background and objective are provided as full text by the user
  //    via the Project Setup form (not interviewed), so their full content_full is
  //    injected as dedicated labeled blocks so the agent has the actual text when
  //    proposing epics. Other approved sections use only their summary_line.
  const backgroundSection = sections.find(
    (s) => s.section_key === 'background' && s.status === 'approved',
  );
  const objectiveSection = sections.find(
    (s) => s.section_key === 'objective' && s.status === 'approved',
  );

  const summaryLines = sections
    .filter(
      (s) =>
        s.status === 'approved' &&
        s.summary_line &&
        s.section_key !== 'background' &&
        s.section_key !== 'objective',
    )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => `- ${s.summary_line}`)
    .join('\n');

  // 2. BRD classification block injected into session layer.
  const classificationBlock = [
    `**BRD Title:** ${brd.title}`,
    `**Business Line:** ${brd.business_line}`,
    `**Product Type:** ${brd.product_type}`,
    `**Mobility Type:** ${brd.mobility_type}`,
    `**Change Type:** ${brd.change_type}`,
    `**Impacted Channels:** ${brd.impacted_channels.join(', ') || 'None selected yet'}`,
    `**Active Section:** ${brd.active_section ?? 'background'}`,
  ].join('\n');

  // 3. Current Task directive — injected for all canonical interview sections.
  //    This is the primary signal the model uses to know which section to work on
  //    and which key to emit in <section_draft>. It must be visually prominent.
  const activeSection = brd.active_section ?? 'background';
  const sectionDirective = SECTION_DIRECTIVE_MAP[activeSection];
  const currentTaskBlock = sectionDirective
    ? [
        '## Current Task',
        '',
        `You are CURRENTLY working on the **${sectionDirective.label}** section (\`section_key: "${activeSection}"\`).`,
        '',
        `- **Purpose of this section:** ${sectionDirective.purpose}`,
        `- Interview the user about THIS section ONLY. Do NOT touch any other section.`,
        `- Completed sections (listed under "Completed Sections" below) are approved and locked — do NOT re-interview or re-draft them.`,
        `- When you have enough information to draft this section, output the block EXACTLY as:`,
        `  \`<section_draft key="${activeSection}">…</section_draft>\``,
        `  The \`key\` attribute MUST be \`"${activeSection}"\` — any other value is an error.`,
        `- After the user approves, the platform will tell you what comes next. Do not self-advance.`,
      ].join('\n')
    : null;

  // 4. Epic context injection for story-generation phases (FLOW-INTEGRATION.md §3.6).
  //    When active_section is 'epic_<n>_stories', inject the current epic's DB id and
  //    title so the agent can populate the epic_id attribute in the <stories> block.
  const epicContextParts: string[] = [];
  if (
    activeSection.startsWith('epic_') &&
    activeSection.endsWith('_stories') &&
    epics.length > 0
  ) {
    // active_section is e.g. 'epic_1_stories' → epicIndex is 0-based (1-based in name)
    const epicIndexStr = activeSection
      .replace('epic_', '')
      .replace('_stories', '');
    const epicIndex = parseInt(epicIndexStr, 10) - 1;
    // epics are sorted by sort_order ascending (guaranteed by the caller's .order() query)
    const currentEpic = epics[epicIndex];
    if (currentEpic) {
      epicContextParts.push(`**Current Epic:** ${currentEpic.title}`);
      epicContextParts.push(
        `**Current Epic ID (use verbatim in <stories> block):** ${currentEpic.id}`,
      );
    }
  }

  // 5. Handoff package injection (if resuming a previous session — step 5 unchanged).
  const sessionInject = brd.handoff_package
    ? `\n<session_resume>\n${JSON.stringify(brd.handoff_package, null, 2)}\n</session_resume>`
    : '';

  // 6. Assemble provided-section blocks for background and objective.
  //    These are written directly by the user in the Project Setup form and are
  //    already approved — the agent must NOT re-interview or re-draft them.
  //    Injected verbatim so the agent has the full text when proposing epics.
  const providedSectionParts: string[] = [];
  if (backgroundSection?.content_full) {
    providedSectionParts.push(
      `## Background (provided by user — approved, do not re-draft)\n\n${backgroundSection.content_full}`,
    );
  }
  if (objectiveSection?.content_full) {
    providedSectionParts.push(
      `## Objective (provided by user — approved, do not re-draft)\n\n${objectiveSection.content_full}`,
    );
  }
  // Expected Value — user-authored in setup (like Background/Objective). Injected
  // as context so epics and user stories aim at the stated business outcome.
  if (brd.expected_value && brd.expected_value.trim()) {
    providedSectionParts.push(
      `## Expected Value (provided by user — the business outcome to aim for)\n\n${brd.expected_value.trim()}`,
    );
  }

  // 6b. Reference document summary injection.
  //     When the user uploaded a source document, /analyze-document produced a
  //     consolidated summary saved to brd_documents.source_summary. Inject it here
  //     so the agent has it as read-only context when proposing epics and user stories.
  //     It is clearly labeled as context-only so the agent does not copy it verbatim.
  const sourceSummaryBlock =
    brd.source_summary && brd.source_summary.trim()
      ? [
          '## Reference Document Summary (context only — not a BRD section)',
          '',
          brd.source_summary.trim(),
          '',
          '*Use this only to inform epics and user stories. Do not copy it verbatim into any section.*',
        ].join('\n')
      : null;

  // 7. Assemble system prompt (three layers + session inject + epic context + current task).
  //    The Current Task block is injected LAST in the Session Context so it appears
  //    closest to the conversation and is hardest for the model to overlook.
  const systemPrompt = [
    getPlatformLayer(prompts),
    '',
    '---',
    '',
    assembleAgentLayer(prompts),
    '',
    '---',
    '',
    '## Session Context',
    '',
    classificationBlock,
    '',
    providedSectionParts.length > 0
      ? `### Provided Sections (pre-approved, use as context)\n\n${providedSectionParts.join('\n\n')}`
      : '',
    sourceSummaryBlock ? `\n${sourceSummaryBlock}` : '',
    summaryLines ? `\n### Completed Sections\n${summaryLines}` : '',
    epicContextParts.length > 0 ? `\n### Current Epic\n\n${epicContextParts.join('\n')}` : '',
    sessionInject,
    currentTaskBlock ? `\n---\n\n${currentTaskBlock}` : '',
  ]
    .join('\n')
    .trim();

  // 7. Build messages array: active section history + new user message.
  //    System turns are excluded from the messages array (they live in system prompt).
  const historyMessages: ChatMessage[] = activeTurns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .map((t) => ({
      role: t.role as 'user' | 'assistant',
      content: t.content,
    }));

  // Append the current user message.
  historyMessages.push({ role: 'user', content: userMessage });

  return { systemPrompt, messages: historyMessages };
}
