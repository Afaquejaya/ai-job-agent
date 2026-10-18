import type { Logger } from '@job-agent/observability';
import type { UserId } from '@job-agent/shared';
import type { SourceDeclaration, SourceId } from './declaration';

export interface JobSearchQuery {
  keywords: string[];
  /** Free-text locations or ISO country codes. */
  locations: string[];
  postedWithinDays: number;
  remoteOnly: boolean;
  limit: number;
}

/** A job exactly as fetched from a source. job-processing turns it into a NormalizedJob. */
export interface RawJobPosting {
  sourceId: SourceId;
  externalId: string;
  url: string;
  fetchedAt: Date;
  payload: unknown;
}

export interface ConnectorContext {
  userId: UserId;
  connectorRunId: string;
  signal: AbortSignal;
  logger: Logger;
}

export type ConnectorErrorCode =
  | 'network'
  | 'rate_limited'
  | 'auth_required'
  | 'blocked'
  | 'parse_error'
  | 'schema_changed'
  | 'policy_disabled';

export class ConnectorError extends Error {
  constructor(
    readonly sourceId: SourceId,
    readonly code: ConnectorErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export interface ConnectorHealth {
  sourceId: SourceId;
  status: 'healthy' | 'degraded' | 'down' | 'disabled' | 'unknown';
  checkedAt: Date;
  lastError: { code: ConnectorErrorCode; message: string; at: Date } | null;
  /** Successful runs / total runs over the recent window, for the health dashboard. */
  recentSuccessRate: number | null;
}

/**
 * One implementation per source. Connectors only fetch and report; they never apply, and
 * they must stop (not work around) when they meet a login wall, CAPTCHA or rate limit.
 */
export interface JobSourceConnector {
  readonly declaration: SourceDeclaration;
  search(query: JobSearchQuery, context: ConnectorContext): AsyncIterable<RawJobPosting>;
  checkHealth(context: ConnectorContext): Promise<ConnectorHealth>;
}

/** What to try when a source is unavailable, in order. */
export type FallbackStep =
  | { type: 'connector'; sourceId: SourceId }
  | { type: 'retry_later' }
  | { type: 'ask_user_for_links' };
