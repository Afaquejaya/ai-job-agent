import type { TokenUsage } from './types';

/**
 * List prices in USD per million tokens, used to ESTIMATE cost and enforce the monthly budget.
 * Source: Anthropic's published model table (checked 2026-10-19). Cache writes are billed at
 * 1.25x the input price (5-minute cache). Update this table when prices change; a model with
 * no entry here cannot be used, because its spend could not be counted against the budget.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': {
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 5,
  },
  'claude-sonnet-5-5': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
  },
  // Haiku 5.5: prices for prompts up to 100K tokens (this app's prompts stay far below that).
  'claude-haiku-5-5': {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
  },
  // Server-side refusal fallbacks may answer with these models (rare); priced so spend is counted.
  'claude-opus-5': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  'claude-opus-4-8': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  'claude-sonnet-5': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
  },
};

export function hasPrice(model: string): boolean {
  return model in MODEL_PRICES;
}

/** Estimated cost in USD. Unknown models are priced at the most expensive listed rate. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price =
    MODEL_PRICES[model] ??
    Object.values(MODEL_PRICES).reduce((a, b) => (b.outputPerMTok > a.outputPerMTok ? b : a));
  const cost =
    (usage.inputTokens * price.inputPerMTok +
      usage.outputTokens * price.outputPerMTok +
      usage.cacheReadTokens * price.cacheReadPerMTok +
      usage.cacheWriteTokens * price.cacheWritePerMTok) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
