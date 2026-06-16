/**
 * /section-checkpoint — ARCHITECTURE.md §3.1, §5
 *
 * Marks a section as approved, writes its full text to brd_sections.content_full,
 * generates the one-line summary, and updates brd_documents.active_section.
 *
 * Called either:
 *   - Explicitly: user clicks "Approve Section" in the UI.
 *   - Automatically: /llm-stream triggers this at the 85% context threshold.
 *
 * Also handles the PATCH action=reopen to re-open a section for revision (§5.5).
 *
 * Methods: POST (approve), PATCH (reopen)
 * Auth: required (JWT)
 *
 * POST body:
 *   {
 *     "brd_id": "uuid",
 *     "section_key": "string",
 *     "approved_content": "string",
 *     "trigger": "user_approval" | "auto_threshold"
 *   }
 *
 * POST response:
 *   { "summary_line": "string", "next_section": "string" }
 *
 * PATCH body:
 *   { "brd_id": "uuid", "section_key": "string", "action": "reopen" }
 *
 * PATCH response:
 *   { "status": "in_progress" }
 */

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';
import { createLLMProvider } from '../_shared/llm/index.ts';
import { getSettings } from '../_shared/settings.ts';

/** Section order for determining the next section after approval. */
const SECTION_ORDER = ['background', 'objective', 'epics_overview'];

function nextSectionKey(currentKey: string): string {
  const idx = SECTION_ORDER.indexOf(currentKey);
  if (idx === -1 || idx === SECTION_ORDER.length - 1) return currentKey;
  return SECTION_ORDER[idx + 1];
}

// ---------------------------------------------------------------------------
// POST — approve section
// ---------------------------------------------------------------------------

async function handleApprove(req: Request, userId: string): Promise<Response> {
  let body: {
    brd_id: string;
    section_key: string;
    approved_content: string;
    trigger: 'user_approval' | 'auto_threshold';
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { brd_id, section_key, approved_content } = body;

  if (!brd_id || !section_key || !approved_content) {
    return new Response(
      JSON.stringify({ error: 'brd_id, section_key, and approved_content are required' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  const db = getServiceClient();

  // Verify ownership.
  const { data: brdRow, error: brdError } = await db
    .from('brd_documents')
    .select('id, title')
    .eq('id', brd_id)
    .eq('owner_id', userId)
    .single();

  if (brdError || !brdRow) {
    return new Response(JSON.stringify({ error: 'BRD not found or access denied' }), {
      status: 404,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  // Fetch section metadata (title, sort_order).
  const { data: sectionRow } = await db
    .from('brd_sections')
    .select('section_title, sort_order')
    .eq('brd_id', brd_id)
    .eq('section_key', section_key)
    .single();

  const sectionTitle = sectionRow?.section_title ?? section_key;
  const sortOrder = sectionRow?.sort_order ?? 0;

  // Step 1: Save approved content + mark section approved.
  const upsertResult = await db
    .from('brd_sections')
    .upsert(
      {
        brd_id,
        section_key,
        section_title: sectionTitle,
        sort_order: sortOrder,
        content_full: approved_content,
        status: 'approved',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brd_id,section_key' },
    );

  if (upsertResult.error) {
    console.error('[section-checkpoint] upsert error:', upsertResult.error);
    return new Response(JSON.stringify({ error: 'Failed to save section' }), {
      status: 500,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  // Step 2: Generate one-line summary via LLM (non-streaming).
  const settings = await getSettings(db);
  const llm = createLLMProvider(settings.ai_model_id);

  let summaryLine = `${sectionTitle} — APPROVED ✓`;
  try {
    const summaryResult = await llm.complete(
      [
        {
          role: 'user',
          content: `Summarise the following BRD section in a single line (max 20 words).
Format exactly as: "${sectionTitle}: [summary]"

Section content:
${approved_content.slice(0, 3000)}`,
        },
      ],
      { maxTokens: 80, temperature: 0 },
    );
    if (summaryResult.text.trim()) {
      summaryLine = summaryResult.text.trim();
    }
  } catch (err) {
    // Non-fatal: fall back to default summary line.
    console.warn('[section-checkpoint] summary generation failed:', err);
  }

  // Step 3: Persist summary_line.
  await db
    .from('brd_sections')
    .update({ summary_line: summaryLine, updated_at: new Date().toISOString() })
    .eq('brd_id', brd_id)
    .eq('section_key', section_key);

  // Step 4: If approving epics_overview, link all epic rows to this section
  //         (FLOW-INTEGRATION.md §3.4).
  if (section_key === 'epics_overview') {
    const { data: epicsOverviewSection } = await db
      .from('brd_sections')
      .select('id')
      .eq('brd_id', brd_id)
      .eq('section_key', 'epics_overview')
      .single();

    if (epicsOverviewSection) {
      await db
        .from('epics')
        .update({ section_id: epicsOverviewSection.id, updated_at: new Date().toISOString() })
        .eq('brd_id', brd_id);
    }
  }

  // Step 5: Advance active_section on brd_documents.
  const nextSection = nextSectionKey(section_key);
  await db
    .from('brd_documents')
    .update({
      active_section: nextSection,
      updated_at: new Date().toISOString(),
    })
    .eq('id', brd_id);

  return new Response(
    JSON.stringify({ summary_line: summaryLine, next_section: nextSection }),
    { status: 200, headers: withCors({ 'Content-Type': 'application/json' }) },
  );
}

// ---------------------------------------------------------------------------
// PATCH — reopen a section for revision (§5.5)
// ---------------------------------------------------------------------------

async function handleReopen(req: Request, userId: string): Promise<Response> {
  let body: { brd_id: string; section_key: string; action: string };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { brd_id, section_key, action } = body;

  if (action !== 'reopen') {
    return new Response(
      JSON.stringify({ error: 'Only action="reopen" is supported via PATCH' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  if (!brd_id || !section_key) {
    return new Response(
      JSON.stringify({ error: 'brd_id and section_key are required' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  const db = getServiceClient();

  // Verify ownership.
  const { data: brdRow, error: brdError } = await db
    .from('brd_documents')
    .select('id')
    .eq('id', brd_id)
    .eq('owner_id', userId)
    .single();

  if (brdError || !brdRow) {
    return new Response(JSON.stringify({ error: 'BRD not found or access denied' }), {
      status: 404,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  // Set section back to in_progress.
  const { error: updateError } = await db
    .from('brd_sections')
    .update({
      status: 'in_progress',
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('brd_id', brd_id)
    .eq('section_key', section_key);

  if (updateError) {
    console.error('[section-checkpoint] reopen error:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to reopen section' }), {
      status: 500,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  // Update brd_documents.active_section to the reopened section.
  await db
    .from('brd_documents')
    .update({
      active_section: section_key,
      updated_at: new Date().toISOString(),
    })
    .eq('id', brd_id);

  return new Response(
    JSON.stringify({ status: 'in_progress' }),
    { status: 200, headers: withCors({ 'Content-Type': 'application/json' }) },
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  let userId: string;
  try {
    const user = await verifyAuth(req);
    userId = user.id;
  } catch (errResponse) {
    return errResponse as Response;
  }

  if (req.method === 'POST') return handleApprove(req, userId);
  if (req.method === 'PATCH') return handleReopen(req, userId);

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
});
