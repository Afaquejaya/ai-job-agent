import { agentMessageInputSchema, type AgentStreamEvent } from '@job-agent/shared';
import { parseJsonBody, withAuth } from '@/server/api';
import { executeTurn, prepareTurn } from '@/server/agent/turn';

export const dynamic = 'force-dynamic';
// One turn may take up to 120 s (AGENT_LIMITS.turnTimeoutMs) plus saving.
export const maxDuration = 150;

/**
 * POST /api/agent/messages - send a message to the agent and stream the turn back as NDJSON
 * (one AgentStreamEvent per line). Everything that can be refused (AI not configured, no
 * consent, unknown or full conversation) is checked first and returned as a normal error.
 * Closing the connection cancels the turn.
 */
export const POST = withAuth(async (request, { auth, logger }) => {
  const input = await parseJsonBody(request, agentMessageInputSchema);
  const prepared = await prepareTurn(auth.userId, input.conversationId, input.message);

  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      let open = true;
      const emit = (event: AgentStreamEvent) => {
        if (!open) return;
        try {
          sink.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // the client went away; the turn still finishes and is saved
        }
      };
      try {
        await executeTurn(auth.userId, prepared, input.message, {
          signal: controller.signal,
          emit,
          logger,
        });
      } catch (error) {
        logger.error('agent.turn_failed', { conversationId: prepared.conversationId, error });
        emit({
          type: 'error',
          code: 'INTERNAL',
          message: 'Something went wrong. Please try again.',
        });
      } finally {
        open = false;
        try {
          sink.close();
        } catch {
          // already closed by a cancelled client
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
});
