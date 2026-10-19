import { runAgentTurn } from '@job-agent/agent-core';
import type { ConversationItem } from '@job-agent/ai-providers';
import { createAgentRepository, type AgentMessageRecord } from '@job-agent/database';
import type { Logger } from '@job-agent/observability';
import {
  AGENT_LIMITS,
  type AgentChatMessage,
  type AgentConversationSummary,
  type AgentStopReason,
  type AgentStreamEvent,
  type AgentTraceEntry,
  type UserId,
} from '@job-agent/shared';
import { createBudgetGuard, createUsageRecorder, requireAiReady, type ReadyAi } from '../ai';
import { ApiProblem } from '../api';
import { getDatabase } from '../db';
import { getCipher } from '../storage';
import { AGENT_SYSTEM_PROMPT } from './prompt';
import { buildAgentTools } from './tools';

/**
 * Message payloads are encrypted: they can contain CV and profile text (tool results), the
 * model's thinking summaries, and the provider transcript that must be replayed unchanged.
 */
interface MessagePayload {
  content: string;
  trace: AgentTraceEntry[];
  /** Assistant only: the conversation items this turn added after the user's message. */
  providerItems?: ConversationItem[];
}

const payloadContext = (userId: string, conversationId: string) =>
  `agent-message:${userId}:${conversationId}`;
const titleContext = (userId: string) => `agent-conversation-title:${userId}`;

function encryptPayload(userId: string, conversationId: string, payload: MessagePayload) {
  return getCipher().encryptText(JSON.stringify(payload), payloadContext(userId, conversationId));
}

function decryptPayload(userId: string, row: AgentMessageRecord): MessagePayload {
  return JSON.parse(
    getCipher().decryptText(row.payloadEncrypted, payloadContext(userId, row.conversationId)),
  ) as MessagePayload;
}

export function toChatMessage(userId: string, row: AgentMessageRecord): AgentChatMessage {
  const payload = decryptPayload(userId, row);
  return {
    id: row.id,
    role: row.role,
    content: payload.content,
    trace: payload.trace,
    stopReason: (row.stopReason as AgentStopReason | null) ?? null,
    model: row.model,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listConversations(userId: UserId): Promise<AgentConversationSummary[]> {
  const rows = await createAgentRepository(getDatabase()).listConversations(userId);
  return rows.map((row) => ({
    id: row.id,
    title: getCipher().decryptText(row.titleEncrypted, titleContext(userId)),
    messageCount: row.messageCount,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getConversationMessages(userId: UserId, conversationId: string) {
  const repo = createAgentRepository(getDatabase());
  await repo.requireConversation(userId, conversationId);
  return (await repo.listMessages(userId, conversationId)).map((row) => toChatMessage(userId, row));
}

export interface PreparedTurn {
  ai: ReadyAi;
  conversationId: string;
  history: ConversationItem[];
}

/**
 * Checks everything that can fail BEFORE the response starts streaming (so it can be a normal
 * HTTP error): AI configured, consent given, conversation owned and not full.
 */
export async function prepareTurn(
  userId: UserId,
  conversationId: string | null,
  message: string,
): Promise<PreparedTurn> {
  const ai = await requireAiReady(userId);
  const repo = createAgentRepository(getDatabase());

  if (!conversationId) {
    const title = message.replace(/\s+/g, ' ').trim().slice(0, 60);
    const created = await repo.createConversation(
      userId,
      getCipher().encryptText(title, titleContext(userId)),
    );
    return { ai, conversationId: created.id, history: [] };
  }

  const conversation = await repo.requireConversation(userId, conversationId);
  if (conversation.messageCount >= AGENT_LIMITS.maxTurnsPerConversation * 2) {
    throw new ApiProblem(
      'CONFLICT',
      `This conversation reached ${AGENT_LIMITS.maxTurnsPerConversation} turns. Start a new conversation.`,
      409,
    );
  }
  // Rebuild the exact transcript: each user message followed by what its turn added.
  const history: ConversationItem[] = [];
  for (const row of await repo.listMessages(userId, conversationId)) {
    const payload = decryptPayload(userId, row);
    if (row.role === 'user') history.push({ kind: 'user_text', text: payload.content });
    else history.push(...(payload.providerItems ?? []));
  }
  return { ai, conversationId, history };
}

/** Runs one turn, streaming events through `emit`, and stores both messages. */
export async function executeTurn(
  userId: UserId,
  prepared: PreparedTurn,
  message: string,
  options: { signal: AbortSignal; emit: (event: AgentStreamEvent) => void; logger: Logger },
): Promise<void> {
  const repo = createAgentRepository(getDatabase());
  const { conversationId } = prepared;

  const userRow = await repo.addMessage(userId, conversationId, {
    role: 'user',
    payloadEncrypted: encryptPayload(userId, conversationId, { content: message, trace: [] }),
  });
  options.emit({ type: 'turn_started', conversationId, userMessageId: userRow.id });

  const usage = createUsageRecorder(userId, conversationId, 'chat');
  const result = await runAgentTurn({
    provider: prepared.ai.provider,
    model: prepared.ai.model,
    system: AGENT_SYSTEM_PROMPT,
    history: prepared.history,
    userText: message,
    tools: buildAgentTools(userId, conversationId, prepared.ai.limits),
    maxSteps: AGENT_LIMITS.maxStepsPerTurn,
    timeoutMs: prepared.ai.limits.turnTimeoutMs,
    maxOutputTokens: 16_000,
    effort: 'medium',
    signal: options.signal,
    beforeModelCall: createBudgetGuard(userId, prepared.ai.budgetUsd),
    onModelUsage: (u, model) => usage.record(u, model),
    onEvent: (event) => options.emit(event),
  });

  const totals = usage.totals();
  const assistantRow = await repo.addMessage(userId, conversationId, {
    role: 'assistant',
    payloadEncrypted: encryptPayload(userId, conversationId, {
      content: result.finalText,
      trace: result.trace,
      providerItems: result.newItems.slice(1),
    }),
    model: result.model,
    stopReason: result.stopReason,
    stepCount: result.modelCalls,
    costUsd: totals.costUsd,
  });
  options.logger.info('agent.turn_finished', {
    conversationId,
    stopReason: result.stopReason,
    modelCalls: result.modelCalls,
    costUsd: totals.costUsd,
  });
  options.emit({
    type: 'turn_finished',
    message: toChatMessage(userId, assistantRow),
    usage: totals,
  });
}
