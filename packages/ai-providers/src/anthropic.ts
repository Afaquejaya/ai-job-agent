import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type {
  AgentStepRequest,
  AgentStepResult,
  CallOptions,
  ConversationItem,
  ModelProvider,
  StepStopReason,
  StructuredRequest,
  StructuredResult,
  TokenUsage,
} from './types';
import { ProviderError } from './types';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/**
 * Server-side refusal fallback (opt-in, recommended for current Claude models): if the model
 * declines for policy reasons, the API re-runs the request on Anthropic's recommended
 * fallback model inside the same call.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Blocks a fallback model must not receive when they came from the declined model. */
const DROP_BEFORE_FALLBACK = new Set([
  'thinking',
  'redacted_thinking',
  'tool_use',
  'server_tool_use',
]);

/**
 * Prepares an assistant turn for sending back. Content is echoed unchanged (thinking blocks
 * must be preserved) except after a mid-output fallback: thinking, tool_use and other
 * model-internal blocks that appear before the last `fallback` block are omitted, as the API
 * requires. Text blocks and everything after the boundary are kept.
 */
export function prepareEchoContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary < 0) return content as unknown as BetaContentBlockParam[];
  return content.filter((block, index) => {
    if (index >= boundary) return true;
    if (block.type === 'text') return true;
    return !DROP_BEFORE_FALLBACK.has(block.type) && block.type !== 'fallback';
  }) as unknown as BetaContentBlockParam[];
}

/** Content produced by the model that actually finished the turn (after the last fallback). */
function finalSegment(content: BetaContentBlock[]): BetaContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  return boundary < 0 ? content : content.slice(boundary + 1);
}

function toUsage(message: BetaMessage): TokenUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
}

function toStopReason(reason: BetaMessage['stop_reason']): StepStopReason {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
    case 'refusal':
      return reason;
    default:
      return 'other';
  }
}

function toMessages(items: ConversationItem[]): BetaMessageParam[] {
  return items.map((item): BetaMessageParam => {
    switch (item.kind) {
      case 'user_text':
        return { role: 'user', content: item.text };
      case 'assistant':
        return {
          role: 'assistant',
          content: prepareEchoContent(item.providerContent as BetaContentBlock[]),
        };
      case 'tool_results':
        // All results of one assistant turn go back in ONE user message.
        return {
          role: 'user',
          content: item.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.toolCallId,
            content: r.content,
            is_error: r.isError,
          })),
        };
    }
  });
}

/** Maps SDK errors to provider-neutral kinds. Messages never include the API key. */
function toProviderError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) {
    return new ProviderError('anthropic', 'cancelled', 'The request was cancelled');
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError('anthropic', 'timeout', 'The AI provider did not answer in time');
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ProviderError('anthropic', 'auth', 'The Anthropic API key was rejected');
  }
  if (error instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(error.headers?.get('retry-after'));
    return new ProviderError(
      'anthropic',
      'rate_limited',
      'The AI provider is rate limiting requests',
      Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
    );
  }
  if (
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return new ProviderError('anthropic', 'unavailable', 'The AI provider is unavailable');
  }
  if (error instanceof Anthropic.APIError && (error.status === 529 || error.status === 503)) {
    return new ProviderError('anthropic', 'unavailable', 'The AI provider is overloaded');
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new ProviderError('anthropic', 'invalid_request', `Request rejected: ${error.message}`);
  }
  return error;
}

/** Minimal client surface the adapter uses (lets tests pass a fake). */
export type AnthropicClientLike = Pick<Anthropic, 'beta'>;

export interface AnthropicProviderOptions {
  apiKey?: string;
  client?: AnthropicClientLike;
  /** Bounded automatic retries for 429/5xx/connection errors (SDK default: 2). */
  maxRetries?: number;
}

/** A tool input that arrived as unparseable JSON is re-requested at most this many times. */
const MAX_JSON_RETRIES = 2;

export function createAnthropicProvider(options: AnthropicProviderOptions): ModelProvider {
  const client =
    options.client ??
    new Anthropic({ apiKey: options.apiKey, maxRetries: options.maxRetries ?? 2 });

  return {
    id: 'anthropic',

    async agentStep(request: AgentStepRequest, call: CallOptions): Promise<AgentStepResult> {
      const params = {
        model: call.model,
        max_tokens: request.maxOutputTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default' as const,
        thinking: { type: 'adaptive' as const, display: 'summarized' as const },
        output_config: { effort: request.effort },
        // Top-level automatic caching: the stable tools + system prefix and the growing
        // conversation are cached between the steps of a turn.
        cache_control: { type: 'ephemeral' as const },
        system: request.system,
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
          strict: true,
          // Inputs stream as they are generated; every input is validated by our code
          // (Zod) before a tool runs, as required when this is on.
          eager_input_streaming: true,
        })),
        messages: toMessages(request.items),
      };

      for (let jsonFailures = 0; ;) {
        try {
          const stream = client.beta.messages.stream(params, {
            signal: call.signal,
            timeout: call.timeoutMs,
          });
          if (call.onTextDelta) stream.on('text', (delta) => call.onTextDelta?.(delta));
          const message = await stream.finalMessage();

          const final = finalSegment(message.content);
          const text = message.content
            .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('');
          const thinking = final
            .filter((b): b is Anthropic.Beta.Messages.BetaThinkingBlock => b.type === 'thinking')
            .map((b) => b.thinking)
            .filter(Boolean)
            .join('\n');
          const stopReason = toStopReason(message.stop_reason);
          return {
            stopReason,
            text,
            thinkingSummary: thinking || null,
            // Never run tools from a refused or truncated turn.
            toolCalls:
              stopReason === 'tool_use'
                ? final
                    .filter(
                      (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use',
                    )
                    .map((b) => ({ id: b.id, name: b.name, input: b.input }))
                : [],
            providerContent: message.content,
            usage: toUsage(message),
            model: { provider: 'anthropic', model: message.model },
            refusalCategory: message.stop_details?.category ?? null,
          };
        } catch (error) {
          // A tool input that could not be parsed at all rejects finalMessage() with a plain
          // (non-API) error: re-issue the same step a bounded number of times.
          if (
            !(error instanceof Anthropic.AnthropicError) &&
            !call.signal.aborted &&
            jsonFailures++ < MAX_JSON_RETRIES
          ) {
            continue;
          }
          throw toProviderError(error);
        }
      }
    },

    async generateStructured<T>(
      request: StructuredRequest<T>,
      call: CallOptions,
    ): Promise<StructuredResult<T>> {
      try {
        const message = await client.beta.messages.parse(
          {
            model: call.model,
            max_tokens: request.maxOutputTokens,
            betas: [FALLBACK_BETA],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: {
              effort: request.effort,
              format: zodOutputFormat(request.schema as never),
            },
            cache_control: { type: 'ephemeral' },
            system: request.system,
            messages: [{ role: 'user', content: request.prompt }],
          },
          { signal: call.signal, timeout: call.timeoutMs },
        );
        const stopReason = toStopReason(message.stop_reason);
        return {
          parsed: stopReason === 'refusal' ? null : ((message.parsed_output as T | null) ?? null),
          stopReason,
          usage: toUsage(message),
          model: { provider: 'anthropic', model: message.model },
          refusalCategory: message.stop_details?.category ?? null,
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}
