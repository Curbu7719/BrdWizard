/**
 * /review-status — poll the compliance batch and, when complete, parse results
 * into brd_warnings.
 *
 * Idempotent: if the batch is still running it returns the running stage; once
 * ended it parses every lens result (KVKK / Data Privacy / Regulation), inserts
 * warnings, and advances review_stage to 'compliance_done'. Calling again after
 * that just returns the current stage.
 *
 * Method: POST   Auth: required (owner)   Body: { brd_id }
 * Returns: { review_stage, counts?, inserted? }
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';
import {
  loadReviewContent,
  parseWarnings,
} from '../_shared/brd-review.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

/** Extract concatenated text from a batch result message. */
function messageText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => (b as { type?: string })?.type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('');
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
    .select('id, review_stage, compliance_batch_id')
    .eq('id', brdId)
    .eq('owner_id', userId)
    .single();
  if (brdErr || !brd) return json({ error: 'BRD not found or access denied' }, 404);

  // Already past compliance — nothing to poll.
  if (brd.review_stage !== 'compliance_running') {
    return json({ review_stage: brd.review_stage });
  }
  if (!brd.compliance_batch_id) {
    return json({ review_stage: brd.review_stage });
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'LLM not configured' }, 500);
  const client = new Anthropic({ apiKey });

  let batch;
  try {
    batch = await client.messages.batches.retrieve(brd.compliance_batch_id);
  } catch (err) {
    console.error('[review-status] batch retrieve failed:', err);
    return json({ error: 'Failed to retrieve batch' }, 502);
  }

  if (batch.processing_status !== 'ended') {
    return json({
      review_stage: 'compliance_running',
      counts: batch.request_counts,
    });
  }

  // Batch ended — parse results into warnings.
  const { sections, stories } = await loadReviewContent(db, brdId);
  const validSectionKeys = new Set(sections.map((s) => s.section_key));
  const validStoryIds = new Set(stories.map((s) => s.id));

  const rows: Array<Record<string, unknown>> = [];
  try {
    for await (const result of await client.messages.batches.results(brd.compliance_batch_id)) {
      const source = result.custom_id; // 'kvkk' | 'data_privacy' | 'regulation'
      if (result.result.type !== 'succeeded') {
        console.warn(`[review-status] lens ${source} did not succeed:`, result.result.type);
        continue;
      }
      const text = messageText(result.result.message);
      const warnings = parseWarnings(text, validSectionKeys, validStoryIds);
      for (const w of warnings) {
        rows.push({
          brd_id: brdId,
          source,
          severity: w.severity,
          target_type: w.target_type,
          target_section_key: w.target_section_key,
          target_story_id: w.target_story_id,
          message: w.message,
          recommendation: w.recommendation,
          status: 'open',
        });
      }
    }
  } catch (err) {
    console.error('[review-status] reading results failed:', err);
    return json({ error: 'Failed to read batch results' }, 502);
  }

  if (rows.length > 0) {
    const { error: insErr } = await db.from('brd_warnings').insert(rows);
    if (insErr) console.error('[review-status] insert warnings failed:', insErr);
  }

  await db
    .from('brd_documents')
    .update({ review_stage: 'compliance_done', updated_at: new Date().toISOString() })
    .eq('id', brdId);

  return json({ review_stage: 'compliance_done', inserted: rows.length });
});
