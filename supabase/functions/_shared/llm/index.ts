/**
 * LLMProvider factory — ARCHITECTURE.md §4.3
 * Reads the LLM_PROVIDER env var and returns the appropriate provider.
 * All edge functions import createLLMProvider() from here so the provider
 * can be swapped without touching individual functions.
 *
 * Supported values for LLM_PROVIDER:
 *   'anthropic' (default) — AnthropicProvider using the admin-selected model
 *   'copilot'             — CopilotProvider (stub; not yet implemented)
 *
 * The active model is admin-selectable via the `ai.model_id` setting; callers that
 * load settings pass it as `modelId`. A provider-side error (5xx/429) fails over to
 * the optional `ANTHROPIC_FALLBACK_MODEL` env secret (no failover when unset).
 */

import { AnthropicProvider } from './anthropic-provider.ts';
// Uncomment when CopilotProvider is implemented:
// import { CopilotProvider } from './copilot-provider.ts';
import type { LLMProvider } from './types.ts';

/** Default model when no admin selection is available (matches DEFAULTS in settings.ts). */
const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';

/**
 * @param modelId  The admin-selected model (`settings.ai_model_id`). Falls back to
 *                 DEFAULT_MODEL_ID when not provided (e.g. settings unavailable).
 */
export function createLLMProvider(modelId?: string): LLMProvider {
  const provider = Deno.env.get('LLM_PROVIDER') ?? 'anthropic';

  if (provider === 'anthropic') {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY env var is required when LLM_PROVIDER=anthropic',
      );
    }
    // Fallback model for provider-side failover — ops-configured secret, optional.
    const fallbackModelId = Deno.env.get('ANTHROPIC_FALLBACK_MODEL') ?? null;
    return new AnthropicProvider(apiKey, modelId ?? DEFAULT_MODEL_ID, fallbackModelId);
  }

  // Copilot branch — uncomment when CopilotProvider is implemented.
  // if (provider === 'copilot') {
  //   return new CopilotProvider();
  // }

  throw new Error(`Unknown LLM_PROVIDER: "${provider}". Supported: anthropic`);
}

// Re-export types so callers can import from a single path.
export type { LLMProvider, ChatMessage, StreamEvent, CompletionOptions, DocumentInput } from './types.ts';
