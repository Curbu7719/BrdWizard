/**
 * /conversation-save — ARCHITECTURE.md §3.1
 *
 * Explicitly saves a single conversation turn without triggering a new LLM call.
 * Used when the client needs to persist a turn independently — e.g. saving a
 * user-edited story, or recording a synthetic turn after a section revision.
 *
 * Method: POST
 * Auth: required (JWT)
 *
 * Request body:
 *   { "brd_id": "uuid", "role": "user"|"assistant", "content": "string", "section_key": "string" }
 *
 * Response:
 *   { "turn_id": "uuid" }
 */

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';

interface ConversationSaveRequest {
  brd_id: string;
  role: 'user' | 'assistant';
  content: string;
  section_key: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  let userId: string;
  try {
    const user = await verifyAuth(req);
    userId = user.id;
  } catch (errResponse) {
    return errResponse as Response;
  }

  let body: ConversationSaveRequest;
  try {
    body = await req.json() as ConversationSaveRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { brd_id, role, content, section_key } = body;

  if (!brd_id || !role || !content || !section_key) {
    return new Response(
      JSON.stringify({ error: 'brd_id, role, content, and section_key are required' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  if (role !== 'user' && role !== 'assistant') {
    return new Response(
      JSON.stringify({ error: 'role must be "user" or "assistant"' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  const db = getServiceClient();

  // Verify BRD ownership.
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

  // Determine the next turn_index.
  const { data: lastTurn } = await db
    .from('conversation_turns')
    .select('turn_index')
    .eq('brd_id', brd_id)
    .order('turn_index', { ascending: false })
    .limit(1);

  const nextIndex = lastTurn && lastTurn.length > 0
    ? (lastTurn[0].turn_index as number) + 1
    : 0;

  // Insert the turn.
  const { data: inserted, error: insertError } = await db
    .from('conversation_turns')
    .insert({
      brd_id,
      section_key,
      turn_index: nextIndex,
      role,
      content,
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    console.error('[conversation-save] insert error:', insertError);
    return new Response(JSON.stringify({ error: 'Failed to save turn' }), {
      status: 500,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  return new Response(
    JSON.stringify({ turn_id: (inserted as { id: string }).id }),
    { status: 201, headers: withCors({ 'Content-Type': 'application/json' }) },
  );
});
