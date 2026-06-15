/**
 * LLMProvider factory — ARCHITECTURE.md §4.3
 * Reads the LLM_PROVIDER env var and returns the appropriate provider.
 * All edge functions import createLLMProvider() from here so the provider
 * can be swapped without touching individual functions.
 *
 * Supported values for LLM_PROVIDER:
 *   'anthropic' (default) — AnthropicProvider using claude-sonnet-4-6
 *   'copilot'             — CopilotProvider (stub; not yet implemented)
 */

import { AnthropicProvider } from './anthropic-provider.ts';
// Uncomment when CopilotProvider is implemented:
// import { CopilotProvider } from './copilot-provider.ts';
import type { LLMProvider } from './types.ts';

export function createLLMProvider(): LLMProvider {
  const provider = Deno.env.get('LLM_PROVIDER') ?? 'anthropic';

  if (provider === 'anthropic') {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY env var is required when LLM_PROVIDER=anthropic',
      );
    }
    // Model id is fixed to claude-sonnet-4-6 per project spec (ARCHITECTURE.md §4.2).
    return new AnthropicProvider(apiKey, 'claude-sonnet-4-6');
  }

  // Copilot branch — uncomment when CopilotProvider is implemented.
  // if (provider === 'copilot') {
  //   return new CopilotProvider();
  // }

  throw new Error(`Unknown LLM_PROVIDER: "${provider}". Supported: anthropic`);
}

// Re-export types so callers can import from a single path.
export type { LLMProvider, ChatMessage, StreamEvent, CompletionOptions, DocumentInput } from './types.ts';
