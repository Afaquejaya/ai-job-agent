import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';
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

/**
 * Ollama adapter: a model running on this computer (decision D-037). Free, and nothing leaves
 * the machine - the base URL must be a loopback address. Uses Ollama's native `/api/chat`
 * (streamed NDJSON) for both agent steps and structured output.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True when `url` is an http(s) URL on this machine. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      LOOPBACK_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

/** What is stored as `providerContent` for an Ollama assistant turn. */
export interface OllamaAssistantContent {
  provider: 'ollama';
  content: string;
  /** Tool calls with the ids this adapter gave them (Ollama's own ids are optional). */
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

interface ChatChunk {
  message?: { content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  prompt_eval_cached_count?: number;
  eval_count?: number;
  error?: string;
}

/** Converts the provider-neutral conversation to Ollama messages. */
export function toOllamaMessages(system: string, items: ConversationItem[]): OllamaMessage[] {
  const messages: OllamaMessage[] = [{ role: 'system', content: system }];
  const toolNames = new Map<string, string>();
  for (const item of items) {
    if (item.kind === 'user_text') {
      messages.push({ role: 'user', content: item.text });
    } else if (item.kind === 'assistant') {
      const content = item.providerContent as OllamaAssistantContent;
      for (const call of content.toolCalls) toolNames.set(call.id, call.name);
      messages.push({
        role: 'assistant',
        content: content.content,
        ...(content.toolCalls.length > 0
          ? {
              tool_calls: content.toolCalls.map((c) => ({
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      });
    } else {
      for (const result of item.results) {
        messages.push({
          role: 'tool',
          tool_name: toolNames.get(result.toolCallId) ?? 'unknown',
          content: result.content,
        });
      }
    }
  }
  return messages;
}

function toStopReason(doneReason: string | undefined, hasToolCalls: boolean): StepStopReason {
  if (hasToolCalls) return 'tool_use';
  if (doneReason === 'length') return 'max_tokens';
  if (doneReason === 'stop' || doneReason === undefined) return 'end_turn';
  return 'other';
}

export interface OllamaProviderOptions {
  baseUrl: string;
  /** Context window requested from Ollama. Its small default silently cuts long input. */
  contextTokens?: number;
  /**
   * Let the model think before each agent step (default true). On a laptop processor thinking
   * can take minutes per step, so the web app turns it off for local models unless asked (D-040).
   */
  thinking?: boolean;
  /** For tests. */
  fetch?: typeof fetch;
}

/** Holds the tools plus a long job post, or a CV, job and analysis. 16K cost ~2 GB more (D-040). */
const DEFAULT_CONTEXT_TOKENS = 8_192;

export function createOllamaProvider(options: OllamaProviderOptions): ModelProvider {
  if (!isLoopbackUrl(options.baseUrl)) {
    throw new Error('OLLAMA_BASE_URL must point to this computer (localhost or 127.0.0.1).');
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? localModelFetch;
  const contextTokens = options.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  // Models without thinking support reject `think: true`; remember them and ask without it.
  const noThinking = new Set<string>();

  /** Streams one /api/chat call and returns the accumulated answer. */
  async function chat(
    body: Record<string, unknown>,
    call: CallOptions,
  ): Promise<{ content: string; thinking: string; toolCalls: OllamaToolCall[]; last: ChatChunk }> {
    const signal = AbortSignal.any([call.signal, AbortSignal.timeout(call.timeoutMs)]);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true, keep_alive: '30m' }),
        signal,
      });
    } catch (error) {
      throw toProviderError(error, call, String(body.model));
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw httpError(response.status, detail, String(body.model));
    }

    let content = '';
    let thinking = '';
    const toolCalls: OllamaToolCall[] = [];
    let last: ChatChunk = {};
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = (line: string) => {
      if (!line.trim()) return;
      const chunk = JSON.parse(line) as ChatChunk;
      if (chunk.error) throw new ProviderError('ollama', 'unavailable', `Ollama: ${chunk.error}`);
      if (chunk.message?.content) {
        content += chunk.message.content;
      }
      if (chunk.message?.thinking) thinking += chunk.message.thinking;
      if (chunk.message?.tool_calls) toolCalls.push(...chunk.message.tool_calls);
      if (chunk.done) last = chunk;
    };
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          handle(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
      }
      handle(buffer);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw toProviderError(error, call, String(body.model));
    }
    const split = splitLeakedThinking(content);
    return {
      content: split.answer,
      thinking: [thinking, split.reasoning].filter(Boolean).join('\n'),
      toolCalls,
      last,
    };
  }

  function usageOf(last: ChatChunk): TokenUsage {
    const cached = last.prompt_eval_cached_count ?? 0;
    return {
      inputTokens: Math.max((last.prompt_eval_count ?? 0) - cached, 0),
      outputTokens: last.eval_count ?? 0,
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
    };
  }

  /** Asks with thinking on; if this model does not support thinking, asks again without it. */
  async function chatWithOptionalThinking(
    body: Record<string, unknown>,
    call: CallOptions,
  ): ReturnType<typeof chat> {
    if (options.thinking === false || noThinking.has(call.model)) {
      return chat({ ...body, think: false }, call);
    }
    try {
      return await chat({ ...body, think: true }, call);
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.kind === 'invalid_request' &&
        /think/i.test(error.message)
      ) {
        noThinking.add(call.model);
        return chat({ ...body, think: false }, call);
      }
      throw error;
    }
  }

  return {
    id: 'ollama',

    async agentStep(request: AgentStepRequest, call: CallOptions): Promise<AgentStepResult> {
      const result = await chatWithOptionalThinking(
        {
          model: call.model,
          messages: toOllamaMessages(request.system, request.items),
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
          options: { num_ctx: contextTokens, num_predict: request.maxOutputTokens },
        },
        call,
      );
      // Sent once the step is complete: until then, streamed text may turn out to be leaked
      // reasoning (see splitLeakedThinking). Heartbeats show progress meanwhile.
      if (result.content) call.onTextDelta?.(result.content);
      const toolCalls = result.toolCalls.map((c, index) => ({
        id: `ollama_${crypto.randomUUID().slice(0, 8)}_${index}`,
        name: c.function.name,
        arguments: c.function.arguments ?? {},
      }));
      const providerContent: OllamaAssistantContent = {
        provider: 'ollama',
        content: result.content,
        toolCalls,
      };
      return {
        stopReason: toStopReason(result.last.done_reason, toolCalls.length > 0),
        text: result.content,
        thinkingSummary: result.thinking.trim() || null,
        toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, input: c.arguments })),
        providerContent,
        usage: usageOf(result.last),
        model: { provider: 'ollama', model: call.model },
        refusalCategory: null,
      };
    },

    async generateStructured<T>(
      request: StructuredRequest<T>,
      call: CallOptions,
    ): Promise<StructuredResult<T>> {
      // Thinking is left off here: on a laptop processor it would double the waiting time, and
      // the evidence check catches what a quicker answer gets wrong.
      const result = await chat(
        {
          model: call.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          format: z.toJSONSchema(request.schema),
          think: false,
          options: { num_ctx: contextTokens, num_predict: request.maxOutputTokens, temperature: 0 },
        },
        call,
      );
      return {
        parsed: parseJson(result.content, request.schema),
        stopReason: toStopReason(result.last.done_reason, false),
        usage: usageOf(result.last),
        model: { provider: 'ollama', model: call.model },
        refusalCategory: null,
      };
    },
  };
}

function httpError(status: number, body: string, model: string): ProviderError {
  let message = body;
  try {
    message = (JSON.parse(body) as { error?: string }).error ?? body;
  } catch {
    // plain-text body
  }
  if (status === 404 && /not found/i.test(message)) {
    return new ProviderError(
      'ollama',
      'invalid_request',
      `The model "${model}" is not downloaded. Run: ollama pull ${model}`,
    );
  }
  if (status >= 500) return new ProviderError('ollama', 'unavailable', `Ollama failed: ${message}`);
  return new ProviderError('ollama', 'invalid_request', `Ollama rejected the request: ${message}`);
}

/**
 * Node's fetch gives up after 5 minutes without response headers or body bytes. A model on a
 * laptop processor can be silent that long while it reads a long prompt, so this client turns
 * those waits off; the caller's own time limit (AbortSignal) is what ends a slow call.
 */
const patientAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const localModelFetch = ((input: string, init?: RequestInit) =>
  undiciFetch(input, { ...(init as object), dispatcher: patientAgent })) as unknown as typeof fetch;

const UNDICI_TIMEOUTS = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  const cause = (error as { cause?: { code?: string } }).cause;
  return (
    UNDICI_TIMEOUTS.has((error as { code?: string }).code ?? '') ||
    UNDICI_TIMEOUTS.has(cause?.code ?? '')
  );
}

function toProviderError(error: unknown, call: CallOptions, model: string): ProviderError {
  if (call.signal.aborted)
    return new ProviderError('ollama', 'cancelled', 'The request was cancelled');
  if (isTimeout(error)) {
    return new ProviderError(
      'ollama',
      'timeout',
      `The local model (${model}) did not finish in time. Try a shorter job text or a smaller model.`,
    );
  }
  return new ProviderError(
    'ollama',
    'unavailable',
    'Ollama is not running on this computer. Start Ollama (from the Start menu) and try again.',
  );
}

/** The answer validated against its schema, or null when it is not valid JSON or does not match. */
function parseJson<T>(text: string, schema: z.ZodType<T>): T | null {
  try {
    const checked = schema.safeParse(JSON.parse(text));
    return checked.success ? checked.data : null;
  } catch {
    return null;
  }
}

/**
 * Some reasoning models on some Ollama versions write their reasoning into the answer itself,
 * ending it with `</think>`, even when thinking is switched off (seen with qwen3:4b on Ollama
 * 0.40.5). The reasoning goes to the step trace; only what follows is the answer.
 */
export function splitLeakedThinking(content: string): { reasoning: string; answer: string } {
  const end = content.lastIndexOf('</think>');
  if (end >= 0) {
    return {
      reasoning: content
        .slice(0, end)
        .replace(/^\s*<think>/, '')
        .trim(),
      answer: content.slice(end + '</think>'.length).trim(),
    };
  }
  // Cut off mid-reasoning (output limit reached): nothing usable as an answer.
  if (/^\s*<think>/.test(content))
    return { reasoning: content.replace(/^\s*<think>/, '').trim(), answer: '' };
  return { reasoning: '', answer: content };
}
