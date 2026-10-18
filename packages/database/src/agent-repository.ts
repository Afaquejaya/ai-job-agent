import type { UserId } from '@job-agent/shared';
import type { Database } from './client';
import { NotFoundError } from './errors';
import type { AgentConversation, AgentMessage } from './generated/prisma/client';

export type AgentConversationRecord = AgentConversation;
export type AgentMessageRecord = AgentMessage;

export interface NewAgentMessage {
  role: 'user' | 'assistant';
  /** Encrypted JSON (message text, trace, provider transcript). */
  payloadEncrypted: Uint8Array<ArrayBuffer>;
  model?: string | null;
  stopReason?: string | null;
  stepCount?: number;
  costUsd?: number | null;
}

/** Agent conversations and messages. Every method is scoped by userId. */
export function createAgentRepository(db: Database) {
  return {
    async createConversation(
      userId: UserId,
      titleEncrypted: Uint8Array<ArrayBuffer>,
    ): Promise<AgentConversationRecord> {
      return db.agentConversation.create({ data: { userId, titleEncrypted } });
    },

    async findConversation(userId: UserId, id: string): Promise<AgentConversationRecord | null> {
      return db.agentConversation.findFirst({ where: { id, userId } });
    },

    async requireConversation(userId: UserId, id: string): Promise<AgentConversationRecord> {
      const row = await db.agentConversation.findFirst({ where: { id, userId } });
      if (!row) throw new NotFoundError('Conversation');
      return row;
    },

    async listConversations(userId: UserId, limit = 30): Promise<AgentConversationRecord[]> {
      return db.agentConversation.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
      });
    },

    /** Messages in order. The conversation must belong to the user. */
    async listMessages(userId: UserId, conversationId: string): Promise<AgentMessageRecord[]> {
      return db.agentMessage.findMany({
        where: { conversationId, userId },
        orderBy: { createdAt: 'asc' },
      });
    },

    async addMessage(
      userId: UserId,
      conversationId: string,
      message: NewAgentMessage,
    ): Promise<AgentMessageRecord> {
      return db.$transaction(async (tx) => {
        const updated = await tx.agentConversation.updateMany({
          where: { id: conversationId, userId },
          data: { messageCount: { increment: 1 } },
        });
        if (updated.count === 0) throw new NotFoundError('Conversation');
        return tx.agentMessage.create({
          data: {
            conversationId,
            userId,
            role: message.role,
            payloadEncrypted: message.payloadEncrypted,
            model: message.model ?? null,
            stopReason: message.stopReason ?? null,
            stepCount: message.stepCount ?? 0,
            costUsd: message.costUsd ?? null,
          },
        });
      });
    },

    async deleteConversation(userId: UserId, id: string): Promise<void> {
      const result = await db.agentConversation.deleteMany({ where: { id, userId } });
      if (result.count === 0) throw new NotFoundError('Conversation');
    },
  };
}

export type AgentRepository = ReturnType<typeof createAgentRepository>;
