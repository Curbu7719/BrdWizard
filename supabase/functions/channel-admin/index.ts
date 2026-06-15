/**
 * /channel-admin — ARCHITECTURE.md §3.1
 *
 * CRUD operations on the `channels` lookup table.
 * Only accessible to users with role='admin' (enforced by both explicit role
 * check in this function AND RLS policy "channels_admin_write").
 *
 * GET    /channel-admin         — list all channels
 * POST   /channel-admin         — create a new channel
 * PATCH  /channel-admin         — update an existing channel (id in body)
 * DELETE /channel-admin         — delete a channel (id in body)
 *
 * All write methods require admin role.
 * GET is accessible to any authenticated user (channels are public reads).
 *
 * Auth: required (JWT) for all methods.
 */

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient, requireAdmin } from '../_shared/supabase-client.ts';

// ---------------------------------------------------------------------------
// Request body types
// ---------------------------------------------------------------------------

interface CreateChannelBody {
  code: string;
  label: string;
  description?: string;
  sort_order?: number;
}

interface UpdateChannelBody {
  id: string;
  code?: string;
  label?: string;
  description?: string;
  sort_order?: number;
  is_active?: boolean;
}

interface DeleteChannelBody {
  id: string;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGet(userId: string): Promise<Response> {
  // Any authenticated user can list channels.
  void userId;

  const db = getServiceClient();
  const { data, error } = await db
    .from('channels')
    .select('id, code, label, description, sort_order, is_active')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[channel-admin] GET error:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch channels' }), {
      status: 500,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  return new Response(JSON.stringify({ channels: data ?? [] }), {
    status: 200,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

async function handlePost(req: Request, userId: string): Promise<Response> {
  // Admin only.
  try {
    await requireAdmin(userId);
  } catch (errResponse) {
    return errResponse as Response;
  }

  let body: CreateChannelBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { code, label, description, sort_order } = body;

  if (!code || !label) {
    return new Response(
      JSON.stringify({ error: 'code and label are required' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from('channels')
    .insert({
      code: code.toUpperCase(),
      label,
      description: description ?? null,
      sort_order: sort_order ?? 0,
    })
    .select('id, code, label, description, sort_order, is_active')
    .single();

  if (error) {
    console.error('[channel-admin] POST error:', error);
    // Unique constraint violation on code.
    if (error.code === '23505') {
      return new Response(
        JSON.stringify({ error: `Channel code "${code}" already exists` }),
        { status: 409, headers: withCors({ 'Content-Type': 'application/json' }) },
      );
    }
    return new Response(JSON.stringify({ error: 'Failed to create channel' }), {
      status: 500,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  return new Response(JSON.stringify({ channel: data }), {
    status: 201,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

async function handlePatch(req: Request, userId: string): Promise<Response> {
  // Admin only.
  try {
    await requireAdmin(userId);
  } catch (errResponse) {
    return errResponse as Response;
  }

  let body: UpdateChannelBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { id, ...updates } = body;

  if (!id) {
    return new Response(
      JSON.stringify({ error: 'id is required in body for PATCH' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  // Normalise code if being updated.
  if (updates.code) {
    updates.code = updates.code.toUpperCase();
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from('channels')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, code, label, description, sort_order, is_active')
    .single();

  if (error) {
    console.error('[channel-admin] PATCH error:', error);
    return new Response(JSON.stringify({ error: 'Failed to update channel' }), {
      status: 500,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  return new Response(JSON.stringify({ channel: data }), {
    status: 200,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

async function handleDelete(req: Request, userId: string): Promise<Response> {
  // Admin only.
  try {
    await requireAdmin(userId);
  } catch (errResponse) {
    return errResponse as Response;
  }

  let body: DeleteChannelBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { id } = body;

  if (!id) {
    return new Response(
      JSON.stringify({ error: 'id is required in body for DELETE' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  const db = getServiceClient();
  const { error } = await db.from('channels').delete().eq('id', id);

  if (error) {
    console.error('[channel-admin] DELETE error:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete channel' }), {
      status: 500,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
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

  switch (req.method) {
    case 'GET':
      return handleGet(userId);
    case 'POST':
      return handlePost(req, userId);
    case 'PATCH':
      return handlePatch(req, userId);
    case 'DELETE':
      return handleDelete(req, userId);
    default:
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: withCors({ 'Content-Type': 'application/json' }),
      });
  }
});
