/**
 * LLMProvider abstraction — ARCHITECTURE.md §4.1
 * Defines the interface all LLM provider implementations must satisfy.
 * Edge functions depend only on this interface, never on a concrete provider.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamEvent {
  type: 'delta' | 'usage' | 'stop' | 'error';
  text?: string;                    // present when type === 'delta'
  inputTokens?: number;             // present when type === 'usage'
  outputTokens?: number;
  contextPct?: number;
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
  error?: string;
}

export interface CompletionOptions {
  maxTokens?: number;
  stream: boolean;
  temperature?: number;
  extendedThinking?: {
    enabled: boolean;
    budgetTokens: number;
  };
  systemPrompt?: string;
}

export interface LLMProvider {
  /**
   * Streaming chat — yields StreamEvents as an async iterable.
   * The Edge Function iterates this and writes SSE chunks.
   */
  streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncIterable<StreamEvent>;

  /**
   * Non-streaming completion — returns full text.
   * Used for: handoff package generation, one-line summaries.
   */
  complete(
    messages: ChatMessage[],
    options: Omit<CompletionOptions, 'stream'>,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }>;

  /**
   * Returns an estimate of how many tokens the given messages would consume.
   * Used before sending to decide whether to checkpoint first.
   */
  estimateTokens(messages: ChatMessage[]): number;

  /**
   * The model identifier string (e.g. 'claude-sonnet-4-6').
   * Used for logging and debug display.
   */
  readonly modelId: string;
}
