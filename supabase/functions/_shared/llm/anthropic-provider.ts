/**
 * AnthropicProvider — ARCHITECTURE.md §4.2
 * Concrete LLMProvider implementation using the Anthropic SDK.
 * Handles streaming chat, non-streaming completions, and retry logic
 * for 429/529 (rate limit / overloaded) errors with exponential backoff.
 *
 * Model used: claude-sonnet-4-6 (per project spec).
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import type {
  LLMProvider,
  ChatMessage,
  CompletionOptions,
  StreamEvent,
  DocumentInput,
} from './types.ts';

/** Maximum number of retry attempts for transient errors (429 / 529). */
const MAX_RETRIES = 4;

/** Base delay in milliseconds for exponential backoff. */
const BASE_DELAY_MS = 500;

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine whether an error is retryable (rate limit or overload).
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    return err.status === 429 || err.status === 529;
  }
  return false;
}

/**
 * Whether to FAIL OVER to the fallback model. Covers provider-side problems with
 * the primary model: any 5xx (incl. 500 api_error / 529 overloaded) and 429.
 * A 4xx like 400/404 (bad request / unknown model) is NOT failed over — that
 * would fail on the fallback too.
 */
function shouldFailover(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    return err.status === 429 || (typeof err.status === 'number' && err.status >= 500);
  }
  return false;
}

/**
 * Execute `fn` with exponential backoff on 429/529 errors.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `AnthropicProvider: retryable error (attempt ${attempt + 1}/${MAX_RETRIES}), waiting ${delay}ms`,
          err,
        );
        await sleep(delay);
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  readonly modelId: string;
  /** Model to fall back to when the primary model returns a provider-side error. */
  readonly fallbackModelId: string | null;

  /**
   * Populated after streamChat completes with any extended thinking content.
   * The caller (llm-stream) reads this after iteration to persist the audit trail.
   * Never sent to the browser.
   */
  lastThinkingContent = '';

  constructor(apiKey: string, modelId = 'claude-sonnet-4-6', fallbackModelId: string | null = null) {
    this.client = new Anthropic({ apiKey });
    this.modelId = modelId;
    // Don't fall over to the same model.
    this.fallbackModelId = fallbackModelId && fallbackModelId !== modelId ? fallbackModelId : null;
  }

  /**
   * Run `run(model)` on the primary model (with retry/backoff). If it fails with a
   * provider-side error (5xx/429) and a fallback model is configured, retry the
   * whole thing once on the fallback model. Other errors propagate unchanged.
   */
  private async withModelFailover<T>(run: (model: string) => Promise<T>): Promise<T> {
    try {
      return await withRetry(() => run(this.modelId));
    } catch (err) {
      if (this.fallbackModelId && shouldFailover(err)) {
        console.warn(
          `AnthropicProvider: failing over from ${this.modelId} to ${this.fallbackModelId}`,
          err,
        );
        return await withRetry(() => run(this.fallbackModelId!));
      }
      throw err;
    }
  }

  async *streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncIterable<StreamEvent> {
    // Build the streaming request parameters. `model` is overwritten per attempt
    // by withModelFailover so a provider-side error can fail over to the fallback.
    const params: Anthropic.MessageCreateParamsStreaming = {
      model: this.modelId,
      max_tokens: options.maxTokens ?? 4096,
      messages,
      stream: true,
    };

    if (options.systemPrompt) {
      params.system = options.systemPrompt;
    }

    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    // Extended thinking — only valid on supported models; budget must be < max_tokens.
    if (options.extendedThinking?.enabled) {
      (params as Record<string, unknown>).thinking = {
        type: 'enabled',
        budget_tokens: options.extendedThinking.budgetTokens,
      };
    }

    // Retry/fail-over the stream *creation* call (not the iteration — once
    // streaming starts retrying mid-stream is unsound; the caller must handle that
    // at a higher level). Failover to the fallback model only triggers on a
    // provider-side error raised before the first chunk.
    const stream = await this.withModelFailover((model) =>
      Promise.resolve(this.client.messages.stream({ ...params, model }))
    );

    // Reset thinking buffer for this call.
    this.lastThinkingContent = '';
    let thinkingBuffer = '';

    for await (const event of stream) {
      // Text delta from normal content blocks.
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'delta', text: event.delta.text };
      }

      // Thinking delta — buffer for audit; never forwarded to the browser.
      if (
        event.type === 'content_block_delta' &&
        (event.delta as { type: string }).type === 'thinking_delta'
      ) {
        thinkingBuffer += (event.delta as { type: string; thinking: string }).thinking ?? '';
      }

      // Usage update during streaming (output tokens known at message_delta).
      if (event.type === 'message_delta') {
        if (event.usage) {
          yield {
            type: 'usage',
            outputTokens: event.usage.output_tokens,
          };
        }
      }

      // Stream complete — emit final stop event with full usage.
      if (event.type === 'message_stop') {
        const msg = await stream.finalMessage();
        // Persist thinking content on instance so caller can access after iteration.
        this.lastThinkingContent = thinkingBuffer;
        yield {
          type: 'stop',
          stopReason: msg.stop_reason as StreamEvent['stopReason'],
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
        };
      }
    }
  }

  async complete(
    messages: ChatMessage[],
    options: Omit<CompletionOptions, 'stream'>,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.modelId,
      max_tokens: options.maxTokens ?? 1024,
      messages,
    };

    if (options.systemPrompt) {
      params.system = options.systemPrompt;
    }

    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    if (options.extendedThinking?.enabled) {
      (params as Record<string, unknown>).thinking = {
        type: 'enabled',
        budget_tokens: options.extendedThinking.budgetTokens,
      };
    }

    const response = await this.withModelFailover((model) =>
      this.client.messages.create({ ...params, model }) as Promise<Anthropic.Message>
    );

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('');

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  async summarizeDocument(
    input: DocumentInput,
    instructions: string,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    // Build the user message content depending on the input kind.
    // PDF: use Claude's native document block so the model processes it properly.
    // Text: wrap in a plain text message — the content was pre-extracted by the caller.
    let userContent: Anthropic.MessageParam['content'];

    if (input.kind === 'pdf') {
      userContent = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: input.base64,
          },
        } as unknown as Anthropic.ContentBlockParam,
        {
          type: 'text',
          text: instructions,
        },
      ];
    } else {
      userContent = `${instructions}\n\nDocument content:\n${input.text}`;
    }

    // max_tokens: background (≤3000 chars ≈ 750 tok) + objective (≈750 tok)
    // + classification element + XML tags + headroom = 2048 is sufficient.
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.modelId,
      max_tokens: 2048,
      messages: [{ role: 'user', content: userContent }],
    };

    const response = await this.withModelFailover((model) =>
      this.client.messages.create({ ...params, model }) as Promise<Anthropic.Message>
    );

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('');

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  estimateTokens(messages: ChatMessage[]): number {
    // Rough estimate: 1 token ≈ 4 chars.
    // Replace with a proper tokeniser if precision is needed.
    const chars = messages.reduce((acc, m) => acc + m.content.length, 0);
    return Math.ceil(chars / 4);
  }
}
