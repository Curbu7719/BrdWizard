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

/**
 * Input descriptor for summarizeDocument.
 *
 * - kind 'pdf'  → provider uses native PDF support (document content block).
 *   base64 is the raw PDF bytes encoded as base64.
 * - kind 'text' → provider wraps the plain text in a normal user message.
 *   Used for pre-extracted DOCX / PPTX content.
 */
export type DocumentInput =
  | { kind: 'pdf'; base64: string }
  | { kind: 'text'; text: string };

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
   * Summarize a document (PDF or plain text) into a structured response.
   *
   * For PDF inputs the provider MUST use native PDF support (document content
   * block) rather than attempting to parse the binary itself.
   * For text inputs the provider wraps the text in a regular user message.
   *
   * The instructions string tells the model what structured output to produce.
   *
   * CopilotProvider throws "document analysis not supported" — callers that
   * want this capability should ensure AnthropicProvider is active.
   */
  summarizeDocument(
    input: DocumentInput,
    instructions: string,
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
