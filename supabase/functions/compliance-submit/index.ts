/**
 * /compliance-submit — submit a BRD for compliance review via the Batch API.
 *
 * Creates ONE message batch with THREE requests, one per lens (KVKK, Data
 * Privacy, Regulation). Each request reviews the whole BRD from its lens and
 * returns warnings keyed to section_key / story_id. The batch runs async; the
 * client then polls /review-status to fetch results.
 *
 * Method: POST   Auth: required (owner)   Body: { brd_id }
 * Returns: { review_stage, compliance_batch_id }
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';
import { getPrompts, getSettings } from '../_shared/settings.ts';
import {
  loadReviewContent,
  buildReviewText,
  outputFormatInstructions,
} from '../_shared/brd-review.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

const LENSES = [
  { custom_id: 'kvkk', promptKey: 'compliance_kvkk' as const },
  { custom_id: 'data_privacy', promptKey: 'compliance_data_privacy' as const },
  { custom_id: 'regulation', promptKey: 'compliance_regulation' as const },
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
  const sectionKeys = sections.map((s) => s.section_key);
  const storyIds = stories.map((s) => s.id);
  const formatBlock = outputFormatInstructions(sectionKeys, storyIds);
  const userContent = `${reviewText}\n${formatBlock}`;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'LLM not configured' }, 500);
  const client = new Anthropic({ apiKey });

  // Build one batch with three lens requests.
  let batch;
  try {
    batch = await client.messages.batches.create({
      requests: LENSES.map((lens) => ({
        custom_id: lens.custom_id,
        params: {
          model: settings.ai_model_id,
          max_tokens: 8000,
          system: prompts[lens.promptKey],
          messages: [{ role: 'user', content: userContent }],
        },
      })),
    });
  } catch (err) {
    console.error('[compliance-submit] batch create failed:', err);
    return json({ error: 'Failed to submit compliance batch' }, 502);
  }

  // Clear any previous compliance warnings — this is a fresh run.
  await db
    .from('brd_warnings')
    .delete()
    .eq('brd_id', brdId)
    .in('source', ['kvkk', 'data_privacy', 'regulation']);

  await db
    .from('brd_documents')
    .update({
      review_stage: 'compliance_running',
      compliance_batch_id: batch.id,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', brdId);

  return json({ review_stage: 'compliance_running', compliance_batch_id: batch.id });
});
