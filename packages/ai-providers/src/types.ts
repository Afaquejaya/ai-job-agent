import type { z } from 'zod';

/**
 * Provider-neutral model interface. Adapters wrap each vendor's API behind `ModelProvider`;
 * no other package imports a vendor SDK.
 *
 * All providers are accessed with API keys. A consumer chat subscription (e.g. a ChatGPT or
 * Claude.ai plan) does not grant API access and is not supported.
 */
export const PROVIDER_IDS = ['anthropic', 'google', 'openai', 'openai_compatible'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ModelCapability =
  'text' | 'structured_output' | 'tool_calling' | 'vision' | 'long_context';

/** What a model call is for. Recorded with every call for cost reporting. */
export type ModelPurpose =
  | 'chat'
  | 'planning'
  | 'cv_parsing'
  | 'job_matching'
  | 'document_generation'
  | 'form_field_mapping';

/** How much the model may think. Maps to the provider's own effort control. */
export type Effort = 'low' | 'medium' | 'high';

export interface ModelRef {
  provider: ProviderId;
  /** Vendor model id. Comes from configuration, never hard-coded in business logic. */
  model: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** A tool the model may ask to use. `inputSchema` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The conversation as the agent loop sees it. Assistant turns keep the provider's own content
 * (`providerContent`, opaque here) because some providers require it to be sent back
 * unchanged - for example thinking blocks.
 */
export type ConversationItem =
  | { kind: 'user_text'; text: string }
  | { kind: 'assistant'; providerContent: unknown }
  | {
      kind: 'tool_results';
      results: Array<{ toolCallId: string; content: string; isError: boolean }>;
    };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type StepStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface AgentStepRequest {
  purpose: ModelPurpose;
  system: string;
  items: ConversationItem[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  effort: Effort;
}

export interface AgentStepResult {
  stopReason: StepStopReason;
  /** Visible text the model wrote in this step. */
  text: string;
  /** Readable summary of the model's reasoning, when the provider returns one. */
  thinkingSummary: string | null;
  /** Tool calls to run, in order. Empty unless `stopReason` is `tool_use`. */
  toolCalls: ToolCall[];
  /** Assistant content to append to the conversation unchanged. */
  providerContent: unknown;
  usage: TokenUsage;
  /** The model that actually answered (can differ after a server-side fallback). */
  model: ModelRef;
  refusalCategory: string | null;
}

export interface StructuredRequest<T> {
  purpose: ModelPurpose;
  system: string;
  prompt: string;
  /** Zod schema of the answer. Keep it to plain object/array/enum/string/boolean shapes. */
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  effort: Effort;
}

export interface StructuredResult<T> {
  /** null when the provider returned no parseable answer (e.g. a refusal). */
  parsed: T | null;
  stopReason: StepStopReason;
  usage: TokenUsage;
  model: ModelRef;
  refusalCategory: string | null;
}

export interface CallOptions {
  model: string;
  signal: AbortSignal;
  timeoutMs: number;
  /** Receives visible text as it is generated (agent steps only). */
  onTextDelta?: (text: string) => void;
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'invalid_request'
  | 'content_filtered'
  | 'budget_exceeded'
  | 'cancelled';

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** Whether the same request may be retried later or on the next model in a chain. */
  get canFallback(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'timeout' || this.kind === 'unavailable';
  }
}

export interface ModelProvider {
  readonly id: ProviderId;
  /** One model call in an agent loop: the model answers or asks to use tools. */
  agentStep(request: AgentStepRequest, options: CallOptions): Promise<AgentStepResult>;
  /** One call whose answer must match a schema (validated before it is returned). */
  generateStructured<T>(
    request: StructuredRequest<T>,
    options: CallOptions,
  ): Promise<StructuredResult<T>>;
}
