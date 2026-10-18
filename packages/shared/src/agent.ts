import { z } from 'zod';

/**
 * Agent chat contracts (Phase 2C). A turn is streamed to the browser as newline-delimited JSON
 * events so the user can watch each step: thinking summaries, tool calls, results and text.
 */

export const AGENT_LIMITS = {
  maxStepsPerTurn: 8,
  turnTimeoutMs: 120_000,
  maxTurnsPerConversation: 20,
  maxUserMessageChars: 40_000,
} as const;

export const agentMessageInputSchema = z
  .object({
    conversationId: z.uuid().nullable(),
    message: z.string().trim().min(1).max(AGENT_LIMITS.maxUserMessageChars),
  })
  .strict();
export type AgentMessageInput = z.infer<typeof agentMessageInputSchema>;

/** One visible step of an agent turn ("How I got here"). */
export type AgentTraceEntry =
  | { type: 'thinking'; step: number; summary: string }
  | {
      type: 'tool';
      step: number;
      toolCallId: string;
      tool: string;
      input: string;
      ok: boolean;
      summary: string;
      durationMs: number;
    }
  | { type: 'limit'; step: number; reason: string };

export interface AgentTurnUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type AgentStopReason =
  'completed' | 'step_limit' | 'timeout' | 'budget_exhausted' | 'refusal' | 'cancelled' | 'error';

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  trace: AgentTraceEntry[];
  stopReason: AgentStopReason | null;
  model: string | null;
  costUsd: number | null;
  createdAt: string;
}

export interface AgentConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

/** Events of `POST /api/agent/messages`, one JSON object per line. */
export type AgentStreamEvent =
  | { type: 'turn_started'; conversationId: string; userMessageId: string }
  | { type: 'thinking'; step: number; summary: string }
  | { type: 'tool_started'; step: number; toolCallId: string; tool: string; input: string }
  | {
      type: 'tool_finished';
      step: number;
      toolCallId: string;
      tool: string;
      ok: boolean;
      summary: string;
      durationMs: number;
    }
  | { type: 'text_delta'; text: string }
  | { type: 'turn_finished'; message: AgentChatMessage; usage: AgentTurnUsage }
  | { type: 'error'; code: string; message: string };

/** `GET /api/ai/usage`. */
export interface AiUsageStatus {
  configured: boolean;
  /** Why AI is unavailable, when it is. */
  unavailableReason: string | null;
  consentGiven: boolean;
  provider: string;
  model: string | null;
  monthToDateUsd: number;
  monthlyBudgetUsd: number | null;
}
