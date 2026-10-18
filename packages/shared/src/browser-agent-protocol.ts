import { z } from 'zod';
import { isoTimestampSchema } from './time';

/**
 * Wire contract between the cloud (web/worker) and the user's local browser agent.
 *
 * Security properties (enforced by the server and re-checked by the agent):
 * - The agent authenticates with its own device credential; the user is derived from the
 *   agent registration on the server, so commands carry no user id.
 * - Every command expires. The agent rejects expired or unknown command types.
 * - `submit_form` is only issued after the server-side policy check allowed it, and is
 *   idempotent per `idempotencyKey`.
 * - Results contain structured observations only - never cookies, passwords or tokens.
 */
export const BROWSER_PROTOCOL_VERSION = 1;

export const browserCommandTypeSchema = z.enum([
  'open_page',
  'inspect_form',
  'fill_fields',
  'capture_evidence',
  'submit_form',
  'request_user_action',
]);
export type BrowserCommandType = z.infer<typeof browserCommandTypeSchema>;

/** Situations the agent must hand back to the user instead of working around. */
export const browserBlockerSchema = z.enum([
  'captcha',
  'otp',
  'login_required',
  'access_denied',
  'rate_limited',
  'unsupported_form',
  'unknown',
]);
export type BrowserBlocker = z.infer<typeof browserBlockerSchema>;

export const browserCommandSchema = z.object({
  protocolVersion: z.literal(BROWSER_PROTOCOL_VERSION),
  commandId: z.uuid(),
  taskId: z.uuid(),
  agentId: z.uuid(),
  type: browserCommandTypeSchema,
  idempotencyKey: z.string().min(16),
  issuedAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type BrowserCommand = z.infer<typeof browserCommandSchema>;

export const browserCommandResultSchema = z.object({
  protocolVersion: z.literal(BROWSER_PROTOCOL_VERSION),
  commandId: z.uuid(),
  agentId: z.uuid(),
  /** `rejected`: the agent refused the command (expired, invalid, unsupported). */
  status: z.enum(['succeeded', 'failed', 'blocked', 'expired', 'rejected']),
  blocker: browserBlockerSchema.optional(),
  observedAt: isoTimestampSchema,
  observation: z.record(z.string(), z.unknown()).optional(),
  errorMessage: z.string().max(2000).optional(),
});
export type BrowserCommandResult = z.infer<typeof browserCommandResultSchema>;

export const agentHeartbeatSchema = z.object({
  protocolVersion: z.literal(BROWSER_PROTOCOL_VERSION),
  agentId: z.uuid(),
  agentVersion: z.string(),
  observedAt: isoTimestampSchema,
  supportedCommands: z.array(browserCommandTypeSchema),
});
export type AgentHeartbeat = z.infer<typeof agentHeartbeatSchema>;
