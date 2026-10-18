import type { z } from 'zod';

/**
 * Provider-neutral model interface. Adapters (Phase 4) wrap each vendor's API behind
 * `ModelProvider`; the rest of the system never imports a vendor SDK directly.
 *
 * All providers are accessed with API keys. A consumer chat subscription (e.g. a ChatGPT or
 * Claude.ai plan) does not grant API access and is not supported.
 */
export const PROVIDER_IDS = ['anthropic', 'google', 'openai', 'openai_compatible'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ModelCapability =
  'text' | 'structured_output' | 'tool_calling' | 'vision' | 'long_context';

/** What a model call is for. Routing preferences are configured per purpose. */
export type ModelPurpose =
  | 'chat'
  | 'planning'
  | 'cv_parsing'
  | 'job_matching'
  | 'document_generation'
  | 'form_field_mapping';

export interface ModelRef {
  provider: ProviderId;
  /** Vendor model id. Comes from configuration, never hard-coded in business logic. */
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest<T = unknown> {
  purpose: ModelPurpose;
  messages: ChatMessage[];
  /** When set, the adapter requests structured output and validates it with this schema. */
  responseSchema?: z.ZodType<T>;
  maxOutputTokens: number;
  temperature?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult<T = unknown> {
  model: ModelRef;
  text: string;
  parsed?: T;
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_call' | 'other';
  latencyMs: number;
}

export interface CallOptions {
  model: string;
  signal: AbortSignal;
  timeoutMs: number;
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'invalid_request'
  | 'content_filtered'
  | 'budget_exceeded';

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

  /** Whether the router may try the same request on the next model in the chain. */
  get canFallback(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'timeout' || this.kind === 'unavailable';
  }
}

export interface ProviderHealth {
  provider: ProviderId;
  status: 'healthy' | 'degraded' | 'down' | 'not_configured';
  checkedAt: Date;
  message?: string;
}

export interface ModelProvider {
  readonly id: ProviderId;
  supports(model: string, capability: ModelCapability): boolean;
  generate<T>(request: GenerateRequest<T>, options: CallOptions): Promise<GenerateResult<T>>;
  checkHealth(signal: AbortSignal): Promise<ProviderHealth>;
}
