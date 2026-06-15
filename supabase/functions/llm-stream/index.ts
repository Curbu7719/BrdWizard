/**
 * /llm-stream — ARCHITECTURE.md §3.1
 *
 * The only path through which the browser touches the Anthropic API.
 * Keeps the API key server-side. Builds the context package, calls Anthropic
 * with streaming enabled, pipes SSE chunks back to the client, then saves
 * the completed turn to DB and handles context threshold logic.
 *
 * Method: POST (browser uses fetch, not EventSource, to be able to send a body)
 * Response: text/event-stream (SSE)
 *
 * SSE event shapes (SseStreamEvent from src/types/brd.ts):
 *   data: {"type":"delta","text":"..."}
 *   data: {"type":"usage","input_tokens":N,"output_tokens":N,"context_pct":N}
 *   data: {"type":"stop","stop_reason":"end_turn"|"max_tokens"|"stop_sequence"}
 *   data: {"type":"truncated"}                 — when stop_reason === "max_tokens"
 *   data: {"type":"warn","context_pct":N}      — >= warn_pct% context window
 *   data: {"type":"checkpoint","context_pct":N}— >= checkpoint_pct%, auto-checkpoint fired
 *   data: {"type":"handoff","context_pct":N}   — >= handoff_pct%, handoff package ready
 *   data: {"type":"turns_exceeded","turn_count":N,"max_turns":N} — section turn cap hit
 *   data: {"type":"error","error":"..."}
 *   data: [DONE]
 */

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';
import { createLLMProvider } from '../_shared/llm/index.ts';
import { AnthropicProvider } from '../_shared/llm/anthropic-provider.ts';
import {
  buildContextPackage,
  type BrdDocument,
  type BrdSection,
  type ConversationTurn,
  type EpicRow,
} from '../_shared/context-builder.ts';
import {
  handleContextThresholds,
  computeContextPct,
  type ThresholdSettings,
} from '../_shared/checkpoint.ts';
import { parseAgentOutput } from '../_shared/output-parser.ts';
import { getSettings, getPrompts } from '../_shared/settings.ts';

// ---------------------------------------------------------------------------
// Section metadata maps (FLOW-INTEGRATION.md §1.2)
// ---------------------------------------------------------------------------

const SECTION_TITLES: Record<string, string> = {
  background: 'Background',
  objective: 'Objective',
  epics_overview: 'Epics Overview',
};

const SECTION_ORDER_MAP: Record<string, number> = {
  background: 0,
  objective: 1,
  epics_overview: 2,
};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

interface LlmStreamRequest {
  brd_id: string;
  user_message: string;
  section_key: string;
}

// ---------------------------------------------------------------------------
// Helper: write one SSE line
// ---------------------------------------------------------------------------

function sseEvent(controller: ReadableStreamDefaultController, payload: unknown): void {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(new TextEncoder().encode(line));
}

function sseDone(controller: ReadableStreamDefaultController): void {
  controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight.
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  // Only POST allowed.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  // Auth check — throws a 401 Response on failure.
  let userId: string;
  try {
    const user = await verifyAuth(req);
    userId = user.id;
  } catch (errResponse) {
    return errResponse as Response;
  }

  // Parse body.
  let body: LlmStreamRequest;
  try {
    body = await req.json() as LlmStreamRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { brd_id, user_message, section_key } = body;

  if (!brd_id || !user_message || !section_key) {
    return new Response(
      JSON.stringify({ error: 'brd_id, user_message, and section_key are required' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  const db = getServiceClient();

  // Load runtime settings and active prompts (60s cached, fallback to defaults).
  const [settings, prompts] = await Promise.all([
    getSettings(db),
    getPrompts(db),
  ]);

  // Load BRD document — verify ownership.
  const { data: brdRow, error: brdError } = await db
    .from('brd_documents')
    .select('*')
    .eq('id', brd_id)
    .eq('owner_id', userId)
    .single();

  if (brdError || !brdRow) {
    return new Response(JSON.stringify({ error: 'BRD not found or access denied' }), {
      status: 404,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const brd = brdRow as BrdDocument;

  // Load all sections and active turns.
  const { data: sectionsRows } = await db
    .from('brd_sections')
    .select('*')
    .eq('brd_id', brd_id)
    .order('sort_order', { ascending: true });

  const sections = (sectionsRows ?? []) as BrdSection[];

  const { data: turnsRows } = await db
    .from('conversation_turns')
    .select('role, content')
    .eq('brd_id', brd_id)
    .eq('section_key', section_key)
    .order('turn_index', { ascending: true });

  const activeTurns = (turnsRows ?? []) as ConversationTurn[];

  // ── Max-turns enforcement (ADMIN-CONFIG.md §5) ────────────────────────────
  // Count user turns already recorded for this section. Each user message = 1 turn.
  const userTurnCount = activeTurns.filter((t) => t.role === 'user').length;
  const maxTurns = settings.context_max_turns_per_section;

  if (userTurnCount >= maxTurns) {
    // BLOCK — do not call the LLM. Emit a synthetic turns_exceeded SSE sequence
    // so the frontend can render the system message and show the "Draft" button.
    const blockedStream = new ReadableStream({
      start(controller) {
        const blockedMessage =
          `Maximum turns for this section reached (${maxTurns}). ` +
          `Use "Draft for approval" to finalise this section and move on, ` +
          `or click the Draft button below.`;

        // Emit the assistant text as a delta so it renders in the chat bubble.
        sseEvent(controller, { type: 'delta', text: blockedMessage });
        sseEvent(controller, { type: 'stop', stop_reason: 'end_turn' });
        sseEvent(controller, {
          type: 'turns_exceeded',
          turn_count: userTurnCount,
          max_turns: maxTurns,
        });
        sseDone(controller);
        controller.close();
      },
    });

    return new Response(blockedStream, {
      status: 200,
      headers: withCors({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      }),
    });
  }

  // Warn suffix injected into system prompt on the final allowed turn.
  const isLastTurn = userTurnCount === maxTurns - 1;
  const turnsWarningSuffix = isLastTurn
    ? '\n<context_warning>This is the final allowed turn for this section. Propose a complete section draft immediately.</context_warning>'
    : '';

  // Load epics — required for story-generation context injection (FLOW-INTEGRATION.md §3.6).
  const { data: epicsRows } = await db
    .from('epics')
    .select('id, title, sort_order')
    .eq('brd_id', brd_id)
    .order('sort_order', { ascending: true });

  const epics = (epicsRows ?? []) as EpicRow[];

  // Build context package — pass DB prompt texts (falls back to embedded if missing).
  const contextPkg = buildContextPackage(
    brd,
    sections,
    activeTurns,
    user_message,
    epics,
    prompts,
  );

  // Append turns warning to system prompt when on the final allowed turn.
  const systemPrompt = contextPkg.systemPrompt + turnsWarningSuffix;
  const { messages } = contextPkg;

  // Threshold settings object for checkpoint.ts.
  const thresholds: ThresholdSettings = {
    contextWindowTokens: settings.context_window_tokens,
    warnTokens: settings.context_threshold_warn_tokens,
    checkpointTokens: settings.context_threshold_checkpoint_tokens,
    handoffTokens: settings.context_threshold_handoff_tokens,
  };

  // Create LLM provider.
  const llm = createLLMProvider();

  // Determine next turn_index by finding the current max.
  const { data: lastTurnRow } = await db
    .from('conversation_turns')
    .select('turn_index')
    .eq('brd_id', brd_id)
    .order('turn_index', { ascending: false })
    .limit(1);

  const nextTurnIndex = lastTurnRow && lastTurnRow.length > 0
    ? (lastTurnRow[0].turn_index as number) + 1
    : 0;

  // Build the SSE stream.
  let inputTokensFinal = 0;
  let outputTokensFinal = 0;
  let stopReasonFinal: string = 'end_turn';
  let assistantText = '';
  let thinkingContent = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const streamIter = llm.streamChat(messages, {
          stream: true,
          systemPrompt,
          // Large cap so a full epic's detailed user-story set (headline +
          // acceptance criteria, possibly Turkish) fits without truncating the
          // <stories> block. Driven by settings (ai.stream_max_tokens).
          maxTokens: settings.ai_stream_max_tokens,
        });

        for await (const event of streamIter) {
          if (event.type === 'delta' && event.text) {
            assistantText += event.text;
            sseEvent(controller, { type: 'delta', text: event.text });
          }

          if (event.type === 'usage') {
            if (event.outputTokens) outputTokensFinal = event.outputTokens;
          }

          if (event.type === 'stop') {
            if (event.inputTokens) inputTokensFinal = event.inputTokens;
            if (event.outputTokens) outputTokensFinal = event.outputTokens;
            if (event.stopReason) stopReasonFinal = event.stopReason;

            const contextPct = computeContextPct(inputTokensFinal, settings.context_window_tokens);

            // Emit usage event.
            sseEvent(controller, {
              type: 'usage',
              input_tokens: inputTokensFinal,
              output_tokens: outputTokensFinal,
              context_pct: contextPct,
            });

            // Emit stop event.
            sseEvent(controller, {
              type: 'stop',
              stop_reason: stopReasonFinal,
            });

            // Emit truncated event if response was cut off.
            if (stopReasonFinal === 'max_tokens') {
              sseEvent(controller, { type: 'truncated' });
            }
          }

          if (event.type === 'error') {
            sseEvent(controller, { type: 'error', error: event.error });
          }
        }

        // Collect thinking content from provider (if AnthropicProvider with extended thinking).
        if (llm instanceof AnthropicProvider) {
          thinkingContent = llm.lastThinkingContent;
        }

        // --- Post-stream DB writes ---

        // Save user turn.
        await db.from('conversation_turns').insert({
          brd_id,
          section_key,
          turn_index: nextTurnIndex,
          role: 'user',
          content: user_message,
          input_tokens: inputTokensFinal,
          output_tokens: 0,
          context_pct: computeContextPct(inputTokensFinal, settings.context_window_tokens),
        });

        // Save assistant turn.
        await db.from('conversation_turns').insert({
          brd_id,
          section_key,
          turn_index: nextTurnIndex + 1,
          role: 'assistant',
          content: assistantText,
          input_tokens: inputTokensFinal,
          output_tokens: outputTokensFinal,
          context_pct: computeContextPct(inputTokensFinal, settings.context_window_tokens),
          thinking_content: thinkingContent || null,
        });

        // Update active_section if it changed.
        if (brd.active_section !== section_key) {
          await db
            .from('brd_documents')
            .update({ active_section: section_key, updated_at: new Date().toISOString() })
            .eq('id', brd_id);
        }

        // ── Parse structured output and persist to DB ──────────────────────
        // (FLOW-INTEGRATION.md §3.1 – §3.3)
        // Run ONLY after the complete assistantText is available.
        const parsed = parseAgentOutput(assistantText);

        if (parsed.type === 'section_draft' && parsed.sectionKey) {
          // Defensive guard: if the BRD's active_section is a canonical section key
          // ('background' | 'objective' | 'epics_overview'), always persist under
          // active_section regardless of what key the model emitted. This prevents
          // mislabeled section rows when the model forgets to update the key attribute
          // (e.g. emits key="background" when active_section is "objective").
          const activeKey = brd.active_section ?? parsed.sectionKey;
          const isCanonical = activeKey in SECTION_TITLES;
          const sKey = isCanonical ? activeKey : parsed.sectionKey;

          // UPSERT brd_sections with status='in_progress'.
          // The user must still click Approve — section-checkpoint sets 'approved'.
          await db.from('brd_sections').upsert(
            {
              brd_id,
              section_key: sKey,
              // Always derive section_title from the map — never use the raw key.
              section_title: SECTION_TITLES[sKey] ?? sKey,
              sort_order: SECTION_ORDER_MAP[sKey] ?? 0,
              content_full: parsed.sectionContent ?? '',
              status: 'in_progress',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'brd_id,section_key' },
          );

          // Emit section_ready AFTER stop event, before [DONE].
          sseEvent(controller, { type: 'section_ready', section_key: sKey });

        } else if (parsed.type === 'epics' && parsed.epics && parsed.epics.length > 0) {
          // Delete existing unapproved epics (agent may be re-proposing).
          await db
            .from('epics')
            .delete()
            .eq('brd_id', brd_id)
            .eq('is_approved', false);

          // Insert new epic rows.
          const epicRows = parsed.epics.map((e) => ({
            brd_id,
            section_id: null,          // linked after epics_overview section is approved
            title: e.title,
            description: e.description,
            sort_order: e.sort_order,
            is_approved: false,
          }));
          await db.from('epics').insert(epicRows);

          sseEvent(controller, { type: 'epics_proposed', brd_id });

        } else if (parsed.type === 'stories' && parsed.epicId) {
          // Delete existing unapproved stories for this epic (agent may regenerate).
          await db
            .from('user_stories')
            .delete()
            .eq('epic_id', parsed.epicId)
            .eq('is_approved', false);

          // Insert new story rows.
          if (parsed.stories && parsed.stories.length > 0) {
            const storyRows = parsed.stories.map((s) => ({
              epic_id: parsed.epicId!,
              brd_id,
              persona: s.persona,
              action: s.action,
              channel_hint: s.channel_hint,
              full_text: s.full_text,
              sort_order: s.sort_order,
              is_approved: false,
              is_edited: false,
            }));
            await db.from('user_stories').insert(storyRows);
          }

          sseEvent(controller, { type: 'stories_ready', epic_id: parsed.epicId });
        }
        // ── End structured output handling ───────────────────────────────────

        // Reload fresh brd + sections for threshold evaluation.
        const { data: freshBrd } = await db
          .from('brd_documents')
          .select('*')
          .eq('id', brd_id)
          .single();

        const { data: freshSections } = await db
          .from('brd_sections')
          .select('*')
          .eq('brd_id', brd_id)
          .order('sort_order', { ascending: true });

        if (freshBrd) {
          const thresholdResult = await handleContextThresholds(
            db,
            llm,
            freshBrd as BrdDocument,
            (freshSections ?? []) as BrdSection[],
            inputTokensFinal,
            thresholds,
          );

          // Emit threshold action event to client if notable.
          if (thresholdResult.action === 'warn') {
            sseEvent(controller, {
              type: 'warn',
              context_pct: thresholdResult.contextPct,
            });
          } else if (thresholdResult.action === 'checkpoint') {
            sseEvent(controller, {
              type: 'checkpoint',
              context_pct: thresholdResult.contextPct,
            });
          } else if (thresholdResult.action === 'handoff') {
            sseEvent(controller, {
              type: 'handoff',
              context_pct: thresholdResult.contextPct,
            });
          }
        }

        sseDone(controller);
        controller.close();
      } catch (err) {
        console.error('[llm-stream] error:', err);
        sseEvent(controller, {
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        sseDone(controller);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: withCors({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering if behind a proxy.
    }),
  });
});
