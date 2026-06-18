/**
 * /export-word — BRD generation audit log
 *
 * NOTE: the .docx is now built in the BROWSER (src/lib/exportDocx.ts). The
 * `docx` package's Packer does not run in the Supabase edge runtime, so this
 * function no longer generates the document. It only records the audit row
 * (brd_generations) used by the admin report — who generated which BRD, with
 * what readiness score, and when.
 *
 * Method: POST
 * Auth: required (JWT)
 * Request body: { "brd_id": "uuid", "score"?: number }
 * Response: { "ok": true }
 */

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let userId: string;
  try {
    const user = await verifyAuth(req);
    userId = user.id;
  } catch (errResponse) {
    return errResponse as Response;
  }

  let body: { brd_id: string; score?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { brd_id, score } = body;
  if (!brd_id) return json({ error: 'brd_id is required' }, 400);

  const db = getServiceClient();

  // Load the BRD title (and verify access) for the audit row.
  const { data: brdRow, error: brdError } = await db
    .from('brd_documents')
    .select('id, title')
    .eq('id', brd_id)
    .or(`owner_id.eq.${userId},visibility.eq.public`)
    .single();

  if (brdError || !brdRow) {
    return json({ error: 'BRD not found or access denied' }, 404);
  }

  const { error: insertError } = await db.from('brd_generations').insert({
    brd_id,
    user_id: userId,
    title: brdRow.title,
    score: typeof score === 'number' ? Math.round(score) : null,
  });

  if (insertError) {
    console.error('[export-word] generation log failed:', insertError);
    return json({ error: 'Failed to record generation' }, 500);
  }

  return json({ ok: true });
});
