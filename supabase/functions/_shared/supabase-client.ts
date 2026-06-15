/**
 * Supabase client helpers — shared across all edge functions.
 *
 * Two clients:
 *   1. Service-role client — bypasses RLS; used only AFTER the caller JWT is verified.
 *      Never expose this client's credentials to the browser.
 *   2. Auth helper — verifies a caller's JWT and returns the User object.
 *
 * Pattern used in every edge function:
 *   const user = await verifyAuth(req);          // 401 if invalid
 *   const db   = getServiceClient();             // use AFTER auth check
 */

import { createClient, SupabaseClient, User } from 'npm:@supabase/supabase-js@2';

/** Lazily initialised service-role client (singleton per isolate). */
let _serviceClient: SupabaseClient | null = null;

/**
 * Returns a service-role Supabase client.
 * This client bypasses RLS — only use it AFTER verifying the caller JWT.
 */
export function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required',
    );
  }

  _serviceClient = createClient(url, key, {
    auth: {
      // Service role should not auto-refresh tokens or persist sessions.
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _serviceClient;
}

/**
 * Verifies the JWT in the Authorization header of the request.
 * Returns the authenticated User on success.
 * Throws a Response(401) on failure — callers should `return` the thrown value.
 *
 * Usage:
 *   const user = await verifyAuth(req);
 */
export async function verifyAuth(req: Request): Promise<User> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.replace('Bearer ', '');

  // Use a temporary anon client to verify the token — avoids service-role exposure.
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY env vars are required');
  }

  const anonClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await anonClient.auth.getUser(token);

  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return data.user;
}

/**
 * Checks that the authenticated user has the 'admin' role in public.profiles.
 * Throws a Response(403) if not.
 * Call AFTER verifyAuth().
 */
export async function requireAdmin(userId: string): Promise<void> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error || data?.role !== 'admin') {
    throw new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
