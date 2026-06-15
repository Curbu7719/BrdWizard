/**
 * /maturity-check — synchronous final review of the whole BRD for contradictions
 * and clarity/completeness gaps. Runs AFTER compliance is done.
 *
 * One LLM call over the entire BRD; warnings (source='maturity') are inserted
 * into brd_warnings and review_stage advances to 'maturity_done'.
 *
 * Method: POST   Auth: required (owner)   Body: { brd_id }
 * Returns: { review_stage, inserted }
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

  await db
    .from('brd_documents')
    .update({ review_stage: 'maturity_running', updated_at: new Date().toISOString() })
    .eq('id', brdId);

  const llm = createLLMProvider();
  let result;
  try {
    result = await llm.complete(
      [{ role: 'user', content: `${reviewText}\n${formatBlock}` }],
      { systemPrompt: prompts.maturity_check, maxTokens: settings.ai_stream_max_tokens, temperature: 0 },
    );
  } catch (err) {
    console.error('[maturity-check] LLM call failed:', err);
    // Roll back to compliance_done so the user can retry.
    await db
      .from('brd_documents')
      .update({ review_stage: 'compliance_done', updated_at: new Date().toISOString() })
      .eq('id', brdId);
    return json({ error: 'Maturity check failed' }, 502);
  }

  const warnings = parseWarnings(result.text, validSectionKeys, validStoryIds);

  // Fresh run — clear previous maturity warnings.
  await db.from('brd_warnings').delete().eq('brd_id', brdId).eq('source', 'maturity');

  if (warnings.length > 0) {
    const rows = warnings.map((w) => ({
      brd_id: brdId,
      source: 'maturity',
      severity: w.severity,
      target_type: w.target_type,
      target_section_key: w.target_section_key,
      target_story_id: w.target_story_id,
      message: w.message,
      recommendation: w.recommendation,
      status: 'open',
    }));
    const { error: insErr } = await db.from('brd_warnings').insert(rows);
    if (insErr) console.error('[maturity-check] insert warnings failed:', insErr);
  }

  await db
    .from('brd_documents')
    .update({ review_stage: 'maturity_done', updated_at: new Date().toISOString() })
    .eq('id', brdId);

  return json({ review_stage: 'maturity_done', inserted: warnings.length });
});
