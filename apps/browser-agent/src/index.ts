import type { AgentHeartbeat, BrowserCommand, BrowserCommandResult } from '@job-agent/shared';
import { optionalEnv } from '@job-agent/shared';
import { z } from 'zod';

/**
 * Local browser agent - runs on the user's own computer, never in the cloud.
 *
 * Phase 1 defines interfaces only; there is no runnable agent yet (see README.md).
 *
 * Flow: the agent connects OUTBOUND to the server (no inbound ports), authenticates with its
 * device credential, receives short-lived commands, executes them with Playwright in a
 * dedicated local browser profile, and reports structured results. Cookies and the browser
 * profile never leave the machine.
 */

export const localAgentConfigSchema = z.object({
  BROWSER_AGENT_SERVER_URL: z.url(),
  /** Dedicated profile directory; git-ignored and never uploaded. */
  BROWSER_AGENT_PROFILE_DIR: z.string().min(1),
  BROWSER_AGENT_DEVICE_TOKEN: optionalEnv(z.string().min(32)),
});
export type LocalAgentConfig = z.infer<typeof localAgentConfigSchema>;

/** Talks to the server over HTTPS. Implemented in Phase 9. */
export interface LocalAgentTransport {
  /** Exchanges a one-time pairing code (shown in the web app) for a device credential. */
  pair(pairingCode: string): Promise<{ agentId: string; deviceToken: string }>;
  /** Long-polls for commands addressed to this agent. */
  receiveCommands(signal: AbortSignal): Promise<BrowserCommand[]>;
  sendResult(result: BrowserCommandResult): Promise<void>;
  sendHeartbeat(heartbeat: AgentHeartbeat): Promise<void>;
}

/** Executes one validated command in the local browser. Implemented with Playwright in Phase 9. */
export interface BrowserAutomationDriver {
  /**
   * Must return `blocked` (never attempt a workaround) on CAPTCHA, OTP, login walls, access
   * denial or rate limiting, and must reject commands that are expired or unsupported.
   */
  execute(command: BrowserCommand, signal: AbortSignal): Promise<BrowserCommandResult>;
  close(): Promise<void>;
}
