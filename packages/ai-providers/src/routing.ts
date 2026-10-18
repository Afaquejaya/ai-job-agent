import type { UserId } from '@job-agent/shared';
import type { ModelCapability, ModelPurpose, ModelRef, TokenUsage } from './types';

/** A user's ordered model preference for one purpose. The first entry is tried first. */
export interface RoutingPreference {
  purpose: ModelPurpose;
  chain: ModelRef[];
}

export interface RouteRequest {
  userId: UserId;
  purpose: ModelPurpose;
  requiredCapabilities: ModelCapability[];
}

/**
 * Chooses the ordered fallback chain for a request: user preference, filtered to configured
 * providers that support every required capability and are not over budget.
 */
export interface ModelRouter {
  resolve(request: RouteRequest): Promise<ModelRef[]>;
}

export interface UsageRecord {
  userId: UserId;
  model: ModelRef;
  purpose: ModelPurpose;
  usage: TokenUsage;
  /** Estimated from the configured price table; null when the price is unknown. */
  estimatedCostUsd: number | null;
  succeeded: boolean;
  occurredAt: Date;
}

/** Records every model call for cost tracking and budget enforcement. */
export interface UsageRecorder {
  record(entry: UsageRecord): Promise<void>;
  /** Spend so far in the current calendar month (UTC). */
  monthToDateCostUsd(userId: UserId): Promise<number>;
}
