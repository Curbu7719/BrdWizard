import { supabase } from './supabase';
import type { SseStreamEvent } from '../types/brd';

interface StreamChatOptions {
  brdId: string;
  userMessage: string;
  sectionKey?: string;
  onEvent: (event: SseStreamEvent) => void;
  onDone: () => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * Streams a chat turn from /llm-stream using fetch + ReadableStream.
 * EventSource cannot POST, so we use fetch with streaming response body.
 * Parses SSE lines: `data: {json}\n\n`
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    opts.onError('Not authenticated');
    return;
  }

  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${baseUrl}/functions/v1/llm-stream`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        brd_id: opts.brdId,
        user_message: opts.userMessage,
        section_key: opts.sectionKey ?? '',
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    opts.onError('Connection failed. Please try again.');
    return;
  }

  if (!response.ok) {
    opts.onError(`Server error ${response.status}. Please try again.`);
    return;
  }

  if (!response.body) {
    opts.onError('No response body received.');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on double-newline SSE event boundaries
      const parts = buffer.split('\n\n');
      // Last part may be incomplete — keep it in buffer
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const line = part.trim();
        if (line === 'data: [DONE]' || line === '[DONE]') {
          opts.onDone();
          return;
        }
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          try {
            const event = JSON.parse(jsonStr) as SseStreamEvent;
            opts.onEvent(event);
            // Do NOT return on 'stop' — structured-flow events (section_ready,
            // epics_proposed, stories_ready) are emitted AFTER 'stop' and BEFORE
            // [DONE], so we must keep reading until [DONE] arrives.
          } catch {
            // malformed JSON — skip
          }
        }
      }
    }
    opts.onDone();
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    opts.onError('Stream interrupted. Please try again.');
  }
}

/** POST to a Supabase edge function with auth header, return JSON. */
export async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { data: null, error: 'Not authenticated' };

  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${baseUrl}/functions/v1/${functionName}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Surface the backend's JSON { error } message instead of a bare status.
      let msg = `Error ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error as string;
      } catch { /* keep the status fallback */ }
      return { data: null, error: msg };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

/** GET a Supabase edge function with auth header, return JSON. */
export async function callEdgeFunctionGet<T>(
  path: string
): Promise<{ data: T | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { data: null, error: 'Not authenticated' };

  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${baseUrl}/functions/v1/${path}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { data: null, error: text || `Error ${res.status}` };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

/** PATCH a Supabase edge function path with auth header, return JSON. */
export async function callEdgeFunctionPatch<T>(
  path: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { data: null, error: 'Not authenticated' };

  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${baseUrl}/functions/v1/${path}`;

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { data: null, error: text || `Error ${res.status}` };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

/**
 * Record a BRD generation in the audit log (brd_generations) via export-word.
 * The .docx itself is built in the browser (see lib/exportDocx); this only logs
 * who generated which BRD with what score. Non-fatal — a logging failure must
 * not block the download the user already received.
 */
export async function logGeneration(brdId: string, score?: number): Promise<{ error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${baseUrl}/functions/v1/export-word`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brd_id: brdId, score }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        if (j?.error) detail = `: ${j.error}`;
      } catch { /* non-JSON body */ }
      return { error: `Log failed (${res.status})${detail}` };
    }
    return { error: null };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
