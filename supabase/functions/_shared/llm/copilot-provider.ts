/**
 * CopilotProvider — ARCHITECTURE.md §4.3
 * Typed stub for a future GitHub Copilot / Azure OpenAI provider.
 *
 * KNOWN LIMITATIONS (from ADR-0001):
 *   - Streaming: likely available but format differs — must be mapped carefully.
 *   - Extended thinking: NOT supported — throws if options.extendedThinking?.enabled.
 *   - Prompt caching: NOT supported — do not send cache_control headers.
 *   - Batch API: NOT supported — use AnthropicProvider for batch workloads.
 *   - Model routing (Haiku/Sonnet/Opus): constrained — modelId param may be ignored.
 *   - Token usage detail: may arrive in a different schema — must be normalised.
 *   - stop_reason: may use a different name or be absent — normalise on read.
 *
 * When implementing:
 *   1. Confirm which npm/Deno package Microsoft publishes for edge runtimes.
 *   2. Map ChatMessage[] → Copilot message format in streamChat / complete.
 *   3. Map Copilot stream events → our StreamEvent interface.
 *   4. Verify streaming works end-to-end in a local Supabase edge function.
 *   5. Set LLM_PROVIDER=copilot env var and uncomment the factory branch in index.ts.
 */

import type { LLMProvider, ChatMessage, CompletionOptions, StreamEvent, DocumentInput } from './types.ts';

export class CopilotProvider implements LLMProvider {
  // TODO: replace with the actual model identifier exposed by the Copilot SDK.
  readonly modelId = 'gpt-4o';

  // SDK import TBD — depends on what Microsoft publishes for Deno/Node edge.
  // import { ... } from 'npm:@github-copilot/sdk'; // hypothetical

  async *streamChat(
    _messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncIterable<StreamEvent> {
    // Guard: extended thinking is not supported by this provider.
    if (options.extendedThinking?.enabled) {
      throw new Error(
        'CopilotProvider: extendedThinking is not supported. Use AnthropicProvider for this step.',
      );
    }

    // TODO: implement
    // 1. Map _messages → Copilot message format.
    // 2. Open a streaming request to the Copilot / Azure OpenAI endpoint.
    // 3. For each chunk: yield { type: 'delta', text: chunk.text }.
    // 4. On completion: yield { type: 'usage', ... } and { type: 'stop', ... }.
    throw new Error('CopilotProvider.streamChat: not yet implemented');
  }

  async complete(
    _messages: ChatMessage[],
    _options: Omit<CompletionOptions, 'stream'>,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    // Non-streaming is more likely available — implement this first when migrating.
    // TODO: implement
    throw new Error('CopilotProvider.complete: not yet implemented');
  }

  // deno-lint-ignore require-await
  async summarizeDocument(
    _input: DocumentInput,
    _instructions: string,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    // Native PDF document blocks and structured summarization require Claude-native
    // features that are not available via the Copilot / Azure OpenAI SDK.
    // This is a known seam — the analyze-document function will fail gracefully
    // if LLM_PROVIDER=copilot is set.
    throw new Error(
      'CopilotProvider: document analysis not supported. Set LLM_PROVIDER=anthropic to use this feature.',
    );
  }

  estimateTokens(messages: ChatMessage[]): number {
    // Rough estimate: 1 token ≈ 4 chars (same heuristic as AnthropicProvider).
    const chars = messages.reduce((acc, m) => acc + m.content.length, 0);
    return Math.ceil(chars / 4);
  }
}
