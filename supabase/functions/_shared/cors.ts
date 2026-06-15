/**
 * CORS helpers — shared across all edge functions.
 * Browser clients POST to edge functions (not using EventSource, which can't POST),
 * so we need proper CORS preflight handling.
 */

/** CORS headers required for browser → edge function calls. */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

/**
 * Returns a 204 No Content response for CORS preflight (OPTIONS) requests.
 * Call this at the top of every Deno.serve handler:
 *
 *   if (req.method === 'OPTIONS') return corsPreflightResponse();
 */
export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Wraps headers with CORS headers.
 * Merges any existing headers so SSE content-type is preserved.
 */
export function withCors(headers: Record<string, string> = {}): Record<string, string> {
  return { ...CORS_HEADERS, ...headers };
}
