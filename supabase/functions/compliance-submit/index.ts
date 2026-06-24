/**
 * /compliance-submit — synchronous compliance review of a BRD.
 *
 * Runs THREE lens reviews (KVKK, Data Privacy, Regulation) in PARALLEL as normal
 * (non-batch) LLM calls, parses each into warnings keyed to section_key / story_id,
 * and inserts them. This is a stateless worker: the CLIENT owns review_stage and
 * runs this concurrently with /maturity-check, advancing to 'maturity_done' once
 * both finish. Cancellation is cooperative — if review_stage is no longer
 * 'compliance_running' when results are ready, they are discarded.
 *
 * Method: POST   Auth: required (owner)   Body: { brd_id }
 * Returns: { inserted } | { cancelled } | { error }
 */

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';
import { createLLMProvider } from '../_shared/llm/index.ts';
import { getPrompts, getSettings } from '../_shared/settings.ts';
import {
  loadReviewContent,
  buildReviewText,
  outputFormatInstructions,
  parseWarnings,
} from '../_shared/brd-review.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

const LENSES = [
  { source: 'kvkk', promptKey: 'compliance_kvkk' as const },
  { source: 'data_privacy', promptKey: 'compliance_data_privacy' as const },
  { source: 'regulation', promptKey: 'compliance_regulation' as const },
];

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let userId: string;
  try {
    const user = await verifyAuth(req);
    userId = user.id;
  } catch (errResponse) {
    return errResponse as Response;
  }

  let body: { brd_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const brdId = body?.brd_id;
  if (!brdId) return json({ error: 'brd_id is required' }, 400);

  const db = getServiceClient();

  // Load BRD and verify ownership.
  const { data: brd, error: brdErr } = await db
    .from('brd_documents')
    .select('id, title, product_type, mobility_type, change_type, impacted_channels')
    .eq('id', brdId)
    .eq('owner_id', userId)
    .single();
  if (brdErr || !brd) return json({ error: 'BRD not found or access denied' }, 404);

  const { sections, epics, stories } = await loadReviewContent(db, brdId);
  if (sections.length === 0) return json({ error: 'Nothing to review yet' }, 400);

  const prompts = await getPrompts(db);
  const settings = await getSettings(db);

  const reviewText = buildReviewText(brd, sections, epics, stories);
  const validSectionKeys = new Set(sections.map((s) => s.section_key));
  const validStoryIds = new Set(stories.map((s) => s.id));
  const formatBlock = outputFormatInstructions(
    sections.map((s) => s.section_key),
    stories.map((s) => s.id),
  );
  const userContent = `${reviewText}\n${formatBlock}`;

  const llm = createLLMProvider(settings.ai_model_id);

  // Run the three lenses in parallel; one lens failing must not sink the others.
  const results = await Promise.allSettled(
    LENSES.map((lens) =>
      llm.complete(
        [{ role: 'user', content: userContent }],
        { systemPrompt: prompts[lens.promptKey], maxTokens: 8000, temperature: 0 },
      ),
    ),
  );

  const rows: Array<Record<string, unknown>> = [];
  let failed = 0;
  results.forEach((res, i) => {
    const lens = LENSES[i];
    if (res.status !== 'fulfilled') {
      failed++;
      console.error(`[compliance-submit] lens ${lens.source} failed:`, res.reason);
      return;
    }
    const warnings = parseWarnings(res.value.text, validSectionKeys, validStoryIds);
    for (const w of warnings) {
      rows.push({
        brd_id: brdId,
        source: lens.source,
        severity: w.severity,
        target_type: w.target_type,
        target_section_key: w.target_section_key,
        target_story_id: w.target_story_id,
        message: w.message,
        recommendation: w.recommendation,
        status: 'open',
      });
    }
  });

  // Every lens failed — surface the error; the client owns the stage and decides
  // how to recover (it runs compliance and maturity in parallel).
  if (failed === LENSES.length) {
    return json({ error: 'Compliance review failed' }, 502);
  }

  // Cooperative cancel: while the lenses ran (the slow part) the user may have
  // cancelled, which resets review_stage away from 'compliance_running'. If so,
  // discard the results.
  const { data: cur } = await db
    .from('brd_documents')
    .select('review_stage')
    .eq('id', brdId)
    .single();
  if (cur?.review_stage !== 'compliance_running') {
    return json({ review_stage: cur?.review_stage ?? 'none', cancelled: true });
  }

  // Fresh run — clear previous compliance warnings before inserting new ones.
  await db
    .from('brd_warnings')
    .delete()
    .eq('brd_id', brdId)
    .in('source', ['kvkk', 'data_privacy', 'regulation']);

  if (rows.length > 0) {
    const { error: insErr } = await db.from('brd_warnings').insert(rows);
    if (insErr) console.error('[compliance-submit] insert warnings failed:', insErr);
  }

  // Stage is owned by the client (which advances to 'maturity_done' once both
  // compliance and maturity finish), so we only report what we inserted.
  return json({ inserted: rows.length });
});
