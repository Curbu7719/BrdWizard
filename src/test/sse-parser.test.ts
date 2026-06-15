/**
 * Unit tests for the SSE stream parser algorithm used in src/lib/sse.ts.
 *
 * Strategy: we copy the core parsing loop out into a pure helper here so we
 * can feed it arbitrary byte chunks without needing Supabase auth or a real
 * network.  The helper mirrors the exact logic in streamChat() — any change
 * to the production loop must be mirrored here.
 *
 * Covers:
 *  - All SseStreamEvent types: delta, usage, stop, truncated, warn,
 *    checkpoint, handoff, error
 *  - [DONE] terminator (both "data: [DONE]" and bare "[DONE]" forms)
 *  - Events split across chunk boundaries
 *  - Multiple events in a single chunk
 *  - Malformed / non-JSON data lines (silently skipped)
 *  - Empty lines and extra whitespace
 *  - stop event triggers onDone callback
 */

import { describe, it, expect, vi } from 'vitest';
import type { SseStreamEvent } from '../types/brd';

// ─── Pure SSE parser extracted from src/lib/sse.ts ───────────────────────────
//
// This mirrors the while-loop body in streamChat() exactly.
// If you change the production loop, update this too.

interface ParseResult {
  events: SseStreamEvent[];
  done: boolean;
}

/**
 * Feed one or more raw byte chunks (as strings) through the SSE parser.
 * Returns every event emitted and whether onDone was triggered.
 */
function parseSseChunks(chunks: string[]): ParseResult {
  const events: SseStreamEvent[] = [];
  let done = false;
  let buffer = '';

  for (const chunk of chunks) {
    buffer += chunk;

    // Split on double-newline SSE event boundaries
    const parts = buffer.split('\n\n');
    // Last part may be incomplete — keep it in buffer
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.trim();

      if (line === 'data: [DONE]' || line === '[DONE]') {
        done = true;
        return { events, done };
      }

      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        try {
          const event = JSON.parse(jsonStr) as SseStreamEvent;
          events.push(event);
          if (event.type === 'stop') {
            done = true;
            return { events, done };
          }
        } catch {
          // malformed JSON — skip (matches production behaviour)
        }
      }
    }
  }

  return { events, done };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('SSE parser — [DONE] terminator', () => {
  it('recognises "data: [DONE]" and sets done=true', () => {
    const { events, done } = parseSseChunks(['data: [DONE]\n\n']);
    expect(done).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('recognises bare "[DONE]" form', () => {
    const { done } = parseSseChunks(['[DONE]\n\n']);
    expect(done).toBe(true);
  });

  it('stops processing events after [DONE]', () => {
    const payload = [
      'data: {"type":"delta","text":"hello"}\n\n',
      'data: [DONE]\n\n',
      'data: {"type":"delta","text":"should-not-appear"}\n\n',
    ].join('');
    const { events, done } = parseSseChunks([payload]);
    expect(done).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('hello');
  });
});

describe('SSE parser — delta event', () => {
  it('parses a single delta event', () => {
    const { events } = parseSseChunks(['data: {"type":"delta","text":"Hello world"}\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'delta', text: 'Hello world' });
  });

  it('accumulates text across multiple delta events', () => {
    const chunks = [
      'data: {"type":"delta","text":"Hello"}\n\n',
      'data: {"type":"delta","text":" "}\n\n',
      'data: {"type":"delta","text":"world"}\n\n',
    ];
    const { events } = parseSseChunks(chunks);
    expect(events).toHaveLength(3);
    const text = events.map(e => e.text).join('');
    expect(text).toBe('Hello world');
  });

  it('handles empty text field in delta', () => {
    const { events } = parseSseChunks(['data: {"type":"delta","text":""}\n\n']);
    expect(events[0]).toMatchObject({ type: 'delta', text: '' });
  });

  it('handles unicode characters in delta text', () => {
    const { events } = parseSseChunks([
      'data: {"type":"delta","text":"Mağaza çalışanı"}\n\n',
    ]);
    expect(events[0].text).toBe('Mağaza çalışanı');
  });
});

describe('SSE parser — usage event', () => {
  it('parses a usage event with all fields', () => {
    const raw = JSON.stringify({
      type: 'usage',
      input_tokens: 1240,
      output_tokens: 87,
      context_pct: 42,
    });
    const { events } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'usage',
      input_tokens: 1240,
      output_tokens: 87,
      context_pct: 42,
    });
  });

  it('parses a usage event with only partial fields', () => {
    const raw = JSON.stringify({ type: 'usage', output_tokens: 200 });
    const { events } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(events[0].type).toBe('usage');
    expect(events[0].output_tokens).toBe(200);
    expect(events[0].input_tokens).toBeUndefined();
  });
});

describe('SSE parser — stop event', () => {
  it('parses a stop event and triggers done', () => {
    const raw = JSON.stringify({ type: 'stop', stop_reason: 'end_turn' });
    const { events, done } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(done).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'stop', stop_reason: 'end_turn' });
  });

  it('parses stop with max_tokens stop_reason', () => {
    const raw = JSON.stringify({ type: 'stop', stop_reason: 'max_tokens' });
    const { events, done } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(done).toBe(true);
    expect(events[0].stop_reason).toBe('max_tokens');
  });

  it('parses stop with stop_sequence stop_reason', () => {
    const raw = JSON.stringify({ type: 'stop', stop_reason: 'stop_sequence' });
    const { events } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(events[0].stop_reason).toBe('stop_sequence');
  });
});

describe('SSE parser — truncated event', () => {
  it('parses a truncated event', () => {
    const { events } = parseSseChunks(['data: {"type":"truncated"}\n\n']);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('truncated');
  });
});

describe('SSE parser — warn event', () => {
  it('parses a warn event with context_pct', () => {
    const raw = JSON.stringify({ type: 'warn', context_pct: 72 });
    const { events } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(events[0]).toEqual({ type: 'warn', context_pct: 72 });
  });

  it('parses warn at the 70% threshold', () => {
    const raw = JSON.stringify({ type: 'warn', context_pct: 70 });
    const { events } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(events[0].context_pct).toBe(70);
  });
});

describe('SSE parser — checkpoint event', () => {
  it('parses a checkpoint event', () => {
    const raw = JSON.stringify({ type: 'checkpoint', context_pct: 85 });
    const { events } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(events[0]).toEqual({ type: 'checkpoint', context_pct: 85 });
  });

  it('does NOT set done on checkpoint', () => {
    const raw = JSON.stringify({ type: 'checkpoint', context_pct: 85 });
    const { done } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(done).toBe(false);
  });
});

describe('SSE parser — handoff event', () => {
  it('parses a handoff event', () => {
    const raw = JSON.stringify({ type: 'handoff', context_pct: 90 });
    const { events } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(events[0]).toEqual({ type: 'handoff', context_pct: 90 });
  });

  it('does NOT set done on handoff (stream continues until [DONE])', () => {
    const raw = JSON.stringify({ type: 'handoff', context_pct: 90 });
    const { done } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(done).toBe(false);
  });
});

describe('SSE parser — error event', () => {
  it('parses an error event with error message', () => {
    const raw = JSON.stringify({ type: 'error', error: 'Internal server error' });
    const { events } = parseSseChunks([`data: ${raw}\n\n`]);
    expect(events[0]).toEqual({ type: 'error', error: 'Internal server error' });
  });

  it('parses an error event without error message', () => {
    const { events } = parseSseChunks(['data: {"type":"error"}\n\n']);
    expect(events[0].type).toBe('error');
    expect(events[0].error).toBeUndefined();
  });
});

describe('SSE parser — chunk boundary handling', () => {
  it('handles an event split exactly at the double-newline boundary', () => {
    // First chunk ends mid-event before the closing \n\n
    const chunk1 = 'data: {"type":"delta","text":"hel';
    const chunk2 = 'lo"}\n\n';
    const { events } = parseSseChunks([chunk1, chunk2]);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('hello');
  });

  it('handles an event split inside the JSON string', () => {
    const chunk1 = 'data: {"type":"delt';
    const chunk2 = 'a","text":"split"}\n\n';
    const { events } = parseSseChunks([chunk1, chunk2]);
    expect(events[0].text).toBe('split');
  });

  it('handles an event split right before the second newline', () => {
    const chunk1 = 'data: {"type":"delta","text":"hi"}\n';
    const chunk2 = '\n';
    const { events } = parseSseChunks([chunk1, chunk2]);
    expect(events[0].text).toBe('hi');
  });

  it('handles multiple events arriving in a single large chunk', () => {
    const bigChunk = [
      'data: {"type":"delta","text":"A"}\n\n',
      'data: {"type":"delta","text":"B"}\n\n',
      'data: {"type":"delta","text":"C"}\n\n',
      'data: {"type":"usage","input_tokens":100,"output_tokens":3,"context_pct":5}\n\n',
    ].join('');
    const { events } = parseSseChunks([bigChunk]);
    expect(events).toHaveLength(4);
    expect(events[0].text).toBe('A');
    expect(events[1].text).toBe('B');
    expect(events[2].text).toBe('C');
    expect(events[3].type).toBe('usage');
  });

  it('handles many tiny single-byte chunks', () => {
    const payload = 'data: {"type":"delta","text":"ok"}\n\n';
    const tinyChunks = payload.split('');
    const { events } = parseSseChunks(tinyChunks);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('ok');
  });

  it('accumulates partial buffer correctly across 3 chunks', () => {
    // Event split into 3 pieces
    const c1 = 'data: {"type":"de';
    const c2 = 'lta","text":"reassembled"';
    const c3 = '}\n\n';
    const { events } = parseSseChunks([c1, c2, c3]);
    expect(events[0].text).toBe('reassembled');
  });
});

describe('SSE parser — malformed / edge input', () => {
  it('silently skips non-JSON data lines', () => {
    const chunks = [
      'data: not-valid-json\n\n',
      'data: {"type":"delta","text":"after bad line"}\n\n',
    ];
    const { events } = parseSseChunks(chunks);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('after bad line');
  });

  it('silently skips lines without "data: " prefix', () => {
    // SSE comment lines (: ...) or empty lines should be ignored
    const chunks = [
      ': this is a comment\n\n',
      'event: message\n\n',
      'data: {"type":"delta","text":"real"}\n\n',
    ];
    const { events } = parseSseChunks(chunks);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('real');
  });

  it('handles empty input gracefully', () => {
    const { events, done } = parseSseChunks([]);
    expect(events).toHaveLength(0);
    expect(done).toBe(false);
  });

  it('handles whitespace-only chunks gracefully', () => {
    const { events, done } = parseSseChunks(['   \n\n   \n\n']);
    expect(events).toHaveLength(0);
    expect(done).toBe(false);
  });

  it('handles a truncated JSON object (last chunk never completes)', () => {
    // Simulates a broken stream where the final double-newline never arrives
    const { events, done } = parseSseChunks(['data: {"type":"delta","text":"incomplete"']);
    expect(events).toHaveLength(0); // not emitted because no \n\n yet
    expect(done).toBe(false);
  });
});

describe('SSE parser — full realistic stream sequence', () => {
  it('parses a complete BRD AI turn: delta stream + usage + stop', () => {
    const stream = [
      'data: {"type":"delta","text":"Here "}\n\n',
      'data: {"type":"delta","text":"are "}\n\n',
      'data: {"type":"delta","text":"your epics."}\n\n',
      'data: {"type":"usage","input_tokens":500,"output_tokens":12,"context_pct":20}\n\n',
      'data: {"type":"stop","stop_reason":"end_turn"}\n\n',
    ];
    const { events, done } = parseSseChunks(stream);
    expect(done).toBe(true);
    const deltas = events.filter(e => e.type === 'delta');
    const text = deltas.map(e => e.text).join('');
    expect(text).toBe('Here are your epics.');
    expect(events.find(e => e.type === 'usage')?.context_pct).toBe(20);
    expect(events.find(e => e.type === 'stop')?.stop_reason).toBe('end_turn');
  });

  it('parses a stream that hits the 85% checkpoint mid-session', () => {
    const stream = [
      'data: {"type":"delta","text":"Saving…"}\n\n',
      'data: {"type":"checkpoint","context_pct":85}\n\n',
      'data: {"type":"delta","text":"Continuing."}\n\n',
      'data: {"type":"stop","stop_reason":"end_turn"}\n\n',
    ];
    const { events, done } = parseSseChunks(stream);
    expect(done).toBe(true);
    expect(events.some(e => e.type === 'checkpoint')).toBe(true);
    expect(events.filter(e => e.type === 'delta')).toHaveLength(2);
  });

  it('parses a stream that triggers handoff at 90%', () => {
    const stream = [
      'data: {"type":"delta","text":"Session ending."}\n\n',
      'data: {"type":"handoff","context_pct":90}\n\n',
      'data: [DONE]\n\n',
    ];
    const { events, done } = parseSseChunks(stream);
    expect(done).toBe(true);
    expect(events.some(e => e.type === 'handoff')).toBe(true);
  });

  it('parses a truncated stream where max_tokens was hit', () => {
    const stream = [
      'data: {"type":"delta","text":"Partial answer"}\n\n',
      'data: {"type":"truncated"}\n\n',
      'data: {"type":"stop","stop_reason":"max_tokens"}\n\n',
    ];
    const { events, done } = parseSseChunks(stream);
    expect(done).toBe(true);
    expect(events.some(e => e.type === 'truncated')).toBe(true);
    expect(events.find(e => e.type === 'stop')?.stop_reason).toBe('max_tokens');
  });

  it('parses a stream where an error occurs mid-stream', () => {
    const stream = [
      'data: {"type":"delta","text":"Starting…"}\n\n',
      'data: {"type":"error","error":"Internal server error"}\n\n',
    ];
    const { events, done } = parseSseChunks(stream);
    expect(done).toBe(false); // error doesn't auto-close, onError callback handles it
    expect(events.find(e => e.type === 'error')?.error).toBe('Internal server error');
  });

  it('handles the 70% warn + continue scenario correctly', () => {
    const stream = [
      'data: {"type":"delta","text":"Question: what is the objective?"}\n\n',
      'data: {"type":"warn","context_pct":72}\n\n',
      'data: {"type":"usage","input_tokens":1400,"output_tokens":50,"context_pct":72}\n\n',
      'data: {"type":"stop","stop_reason":"end_turn"}\n\n',
    ];
    const { events, done } = parseSseChunks(stream);
    expect(done).toBe(true);
    const warn = events.find(e => e.type === 'warn');
    expect(warn?.context_pct).toBe(72);
  });
});

describe('SSE parser — event ordering guarantees', () => {
  it('preserves event order across split chunks', () => {
    // Simulate 4 events where the 2nd-3rd split across a chunk boundary
    const part1 =
      'data: {"type":"delta","text":"1"}\n\ndata: {"type":"delta","text":"2"}\n';
    const part2 =
      '\ndata: {"type":"delta","text":"3"}\n\ndata: {"type":"stop","stop_reason":"end_turn"}\n\n';
    const { events } = parseSseChunks([part1, part2]);
    const deltas = events.filter(e => e.type === 'delta');
    expect(deltas.map(e => e.text)).toEqual(['1', '2', '3']);
  });

  it('emits stop as the very last event before done', () => {
    const stream = [
      'data: {"type":"delta","text":"x"}\n\n',
      'data: {"type":"usage","output_tokens":1}\n\n',
      'data: {"type":"stop","stop_reason":"end_turn"}\n\n',
    ];
    const { events, done } = parseSseChunks(stream);
    expect(done).toBe(true);
    expect(events[events.length - 1].type).toBe('stop');
  });
});

// ─── Spy-based test: ensure the parser calls onEvent / onDone correctly ───────

describe('SSE parser — callback invocation behaviour', () => {
  /**
   * Re-implements the parser using vi.fn() spies to verify the callbacks
   * that the production streamChat() would invoke.  This is the closest we
   * can get to the production code without importing supabase.
   */
  function runWithSpies(chunks: string[]) {
    const onEvent = vi.fn();
    const onDone = vi.fn();

    let buffer = '';
    for (const chunk of chunks) {
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const line = part.trim();
        if (line === 'data: [DONE]' || line === '[DONE]') {
          onDone();
          return { onEvent, onDone };
        }
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as SseStreamEvent;
            onEvent(event);
            if (event.type === 'stop') {
              onDone();
              return { onEvent, onDone };
            }
          } catch {
            // skip
          }
        }
      }
    }
    return { onEvent, onDone };
  }

  it('calls onEvent once per delta and onDone once on stop', () => {
    const { onEvent, onDone } = runWithSpies([
      'data: {"type":"delta","text":"hi"}\n\n',
      'data: {"type":"stop","stop_reason":"end_turn"}\n\n',
    ]);
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('calls onDone exactly once on [DONE]', () => {
    const { onDone } = runWithSpies(['data: [DONE]\n\n']);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onDone for warn, checkpoint, or handoff events', () => {
    const stream = [
      'data: {"type":"warn","context_pct":70}\n\n',
      'data: {"type":"checkpoint","context_pct":85}\n\n',
      'data: {"type":"handoff","context_pct":90}\n\n',
    ];
    const { onDone } = runWithSpies(stream);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('passes each event object correctly to onEvent', () => {
    const { onEvent } = runWithSpies([
      'data: {"type":"delta","text":"hello"}\n\n',
      'data: {"type":"usage","input_tokens":100,"output_tokens":5,"context_pct":10}\n\n',
    ]);
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'delta', text: 'hello' });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'usage',
      input_tokens: 100,
      output_tokens: 5,
      context_pct: 10,
    });
  });
});
