import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { streamChat } from '../lib/sse';
import type { SseStreamEvent, TurnRole } from '../types/brd';

export type MessageStatus = 'idle' | 'streaming' | 'error' | 'truncated';

export interface ChatMessage {
  id: string;
  role: TurnRole;
  content: string;
  status: MessageStatus;
}

export type ContextWarningLevel = 'none' | 'warn' | 'checkpoint' | 'handoff';

let msgCounter = 0;
function nextId() {
  return `msg-${++msgCounter}`;
}

// Synthetic continuation turns (e.g. "[approved]", "[ready: next epic]") are sent
// to the backend to advance the agent but must NOT show as user chat bubbles.
const CONTROL_TOKEN_RE = /^\[(approved|ready|draft-section)\b.*\]$/i;

interface UseChatOptions {
  brdId: string;
  sectionKey?: string;
  onContextEvent?: (level: ContextWarningLevel, pct?: number) => void;
  /** Called when backend signals a section draft is ready for approval. */
  onSectionReady?: (sectionKey: string) => void;
  /** Called when backend signals epics have been proposed. */
  onEpicsProposed?: () => void;
  /** Called when backend signals stories are ready for an epic. */
  onStoriesReady?: (epicId: string) => void;
}

export function useChat({
  brdId,
  sectionKey,
  onContextEvent,
  onSectionReady,
  onEpicsProposed,
  onStoriesReady,
}: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [contextLevel, setContextLevel] = useState<ContextWarningLevel>('none');
  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // History load on mount (§7.1 of FLOW-INTEGRATION.md).
  // Load the WHOLE conversation (all sections) once per BRD so resuming shows
  // prior turns. NOT keyed by sectionKey — clearing on every section transition
  // would race with the continuation send() that fires during a transition and
  // wipe in-flight messages.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!brdId) return;

    async function loadHistory() {
      const { data } = await supabase
        .from('conversation_turns')
        .select('role, content')
        .eq('brd_id', brdId)
        .order('turn_index', { ascending: true });

      if (data) {
        const loaded: ChatMessage[] = data
          .filter(t => !(t.role === 'user' && CONTROL_TOKEN_RE.test(t.content)))
          .map(t => ({
            id: nextId(),
            role: t.role as TurnRole,
            content: t.content,
            status: 'idle' as MessageStatus,
          }));
        setMessages(loaded);
      }
    }

    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brdId]);

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function addMessage(msg: Omit<ChatMessage, 'id'>) {
    const m: ChatMessage = { ...msg, id: nextId() };
    setMessages(prev => [...prev, m]);
    return m.id;
  }

  function updateMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
  }

  // ---------------------------------------------------------------------------
  // send
  // ---------------------------------------------------------------------------
  const send = useCallback(
    // sectionKeyOverride lets a transition handler send the continuation turn to
    // the freshly-computed next section without waiting for a re-render to update
    // the captured sectionKey (which caused every turn to land in 'background').
    async (userText: string, sectionKeyOverride?: string) => {
      if (streaming || !userText.trim()) return;

      // Add user message — but hide synthetic control tokens from the chat.
      if (!CONTROL_TOKEN_RE.test(userText)) {
        addMessage({ role: 'user', content: userText, status: 'idle' });
      }

      // Add placeholder assistant message
      const assistantId = addMessage({ role: 'assistant', content: '', status: 'streaming' });

      setStreaming(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      await streamChat({
        brdId,
        userMessage: userText,
        sectionKey: sectionKeyOverride ?? sectionKey,
        signal: ctrl.signal,
        onEvent: (event: SseStreamEvent) => {
          switch (event.type) {
            case 'delta':
              if (event.text) {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId ? { ...m, content: m.content + event.text } : m
                  )
                );
              }
              break;
            case 'stop':
              // Mark assistant message done but keep reading stream for structured events.
              updateMessage(assistantId, { status: 'idle' });
              break;
            case 'warn':
              setContextLevel('warn');
              onContextEvent?.('warn', event.context_pct);
              break;
            case 'checkpoint':
              setContextLevel('checkpoint');
              onContextEvent?.('checkpoint', event.context_pct);
              addMessage({
                role: 'system',
                content: 'The current section has been automatically saved as a checkpoint. Continuing to the next section.',
                status: 'idle',
              });
              break;
            case 'handoff':
              setContextLevel('handoff');
              onContextEvent?.('handoff', event.context_pct);
              addMessage({
                role: 'system',
                content: 'Session limit reached. Your progress has been saved. Return to this BRD and the AI will resume from where you left off.',
                status: 'idle',
              });
              break;
            case 'truncated':
              updateMessage(assistantId, { status: 'truncated' });
              break;
            case 'error':
              updateMessage(assistantId, { status: 'error', content: event.error ?? 'Something went wrong.' });
              break;
            // ── Structured-flow events (FLOW-INTEGRATION.md §4) ──────────────
            case 'section_ready':
              if (event.section_key) onSectionReady?.(event.section_key);
              break;
            case 'epics_proposed':
              onEpicsProposed?.();
              break;
            case 'stories_ready':
              if (event.epic_id) onStoriesReady?.(event.epic_id);
              break;
          }
        },
        onDone: () => {
          // Ensure the assistant bubble is marked idle when the stream fully closes.
          updateMessage(assistantId, { status: 'idle' });
          setStreaming(false);
        },
        onError: (msg) => {
          updateMessage(assistantId, { status: 'error', content: msg });
          setStreaming(false);
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brdId, sectionKey, streaming, onContextEvent, onSectionReady, onEpicsProposed, onStoriesReady]
  );

  function abort() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function addSystemMessage(content: string) {
    addMessage({ role: 'system', content, status: 'idle' });
  }

  function resetContextLevel() {
    setContextLevel('none');
  }

  return { messages, streaming, contextLevel, send, abort, addSystemMessage, resetContextLevel };
}
