import type {
  ConversationItem,
  Effort,
  ModelProvider,
  ModelRef,
  TokenUsage,
} from '@job-agent/ai-providers';
import { ProviderError } from '@job-agent/ai-providers';
import type { AgentStopReason, AgentTraceEntry } from '@job-agent/shared';
import type { z } from 'zod';

/**
 * The agent loop (Phase 2C). The model reads the conversation and the tool list, then either
 * answers or asks to use tools. This code - not the model - decides what runs: unknown tools
 * and invalid inputs are refused, every tool has a timeout, and the turn stops at the step
 * limit, the deadline, the budget, a refusal, or a cancellation. Every step is recorded.
 */

export interface AgentToolContext {
  signal: AbortSignal;
  /** The user's message for this turn (tools may use it, e.g. to save pasted text exactly). */
  userText: string;
}

export interface AgentToolOutput {
  /** Sent back to the model (JSON-serialised). */
  result: unknown;
  /** One short line for the step trace. Must not contain CV or profile content. */
  summary: string;
}

export interface AgentTool<Input = unknown> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  /** JSON Schema shown to the model (all properties required, no additional properties). */
  inputJsonSchema: Record<string, unknown>;
  timeoutMs: number;
  execute(input: Input, context: AgentToolContext): Promise<AgentToolOutput>;
}

/** A tool failure whose message is safe to show to the model and the user. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Thrown by `beforeModelCall` when the monthly AI budget is used up. */
export class BudgetExceededError extends Error {
  constructor(message = 'The monthly AI budget has been used up.') {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export type AgentLoopEvent =
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
  | { type: 'text_delta'; text: string };

export interface RunAgentTurnOptions {
  provider: ModelProvider;
  model: string;
  system: string;
  /** Earlier turns, exactly as produced before (append-only). */
  history: ConversationItem[];
  userText: string;
  tools: AgentTool<never>[];
  maxSteps: number;
  /** Wall-clock limit for the whole turn. */
  timeoutMs: number;
  maxOutputTokens: number;
  effort: Effort;
  signal: AbortSignal;
  /** Runs before every model call; throw BudgetExceededError to stop. */
  beforeModelCall?: () => Promise<void>;
  /** Called after every model call with what it used (for cost tracking). */
  onModelUsage?: (usage: TokenUsage, model: ModelRef) => Promise<void>;
  onEvent?: (event: AgentLoopEvent) => void;
  now?: () => number;
}

export interface AgentTurnResult {
  finalText: string;
  stopReason: AgentStopReason;
  trace: AgentTraceEntry[];
  /** The items this turn added to the conversation (append to history for the next turn). */
  newItems: ConversationItem[];
  modelCalls: number;
  model: string | null;
}

const MAX_TOOL_INPUT_PREVIEW = 300;

function preview(value: unknown): string {
  const json = JSON.stringify(value) ?? '';
  return json.length > MAX_TOOL_INPUT_PREVIEW ? `${json.slice(0, MAX_TOOL_INPUT_PREVIEW)}…` : json;
}

async function withTimeout<T>(work: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ToolError(`The tool did not finish within ${ms / 1000}s`)),
      ms,
    );
    signal.addEventListener('abort', () => reject(new ToolError('Cancelled')), { once: true });
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

const STOP_MESSAGES: Record<Exclude<AgentStopReason, 'completed'>, string> = {
  step_limit: 'I stopped because this request needed more steps than allowed in one turn.',
  timeout: 'I stopped because this request took longer than the time allowed for one turn.',
  budget_exhausted: 'I stopped because the monthly AI budget has been used up.',
  refusal: 'The AI model declined this request.',
  cancelled: 'The request was cancelled.',
  error: 'Something went wrong while contacting the AI provider.',
};

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<AgentTurnResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const toolSpecs = options.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputJsonSchema,
  }));

  const userItem: ConversationItem = { kind: 'user_text', text: options.userText };
  const items: ConversationItem[] = [...options.history, userItem];
  const newItems: ConversationItem[] = [userItem];
  const trace: AgentTraceEntry[] = [];
  let modelCalls = 0;
  let model: string | null = null;

  const finish = (stopReason: AgentStopReason, text: string, step: number, detail?: string) => {
    if (stopReason !== 'completed') {
      trace.push({ type: 'limit', step, reason: detail ?? STOP_MESSAGES[stopReason] });
    }
    const fallback = stopReason === 'completed' ? '' : STOP_MESSAGES[stopReason];
    return {
      finalText: text.trim() || fallback,
      stopReason,
      trace,
      newItems,
      modelCalls,
      model,
    } satisfies AgentTurnResult;
  };

  let lastText = '';
  for (let step = 1; step <= options.maxSteps; step++) {
    if (options.signal.aborted) return finish('cancelled', lastText, step);
    const remaining = deadline - now();
    if (remaining <= 0) return finish('timeout', lastText, step);

    try {
      await options.beforeModelCall?.();
    } catch (error) {
      if (error instanceof BudgetExceededError)
        return finish('budget_exhausted', lastText, step, error.message);
      throw error;
    }

    let result;
    try {
      result = await options.provider.agentStep(
        {
          purpose: 'chat',
          system: options.system,
          items,
          tools: toolSpecs,
          maxOutputTokens: options.maxOutputTokens,
          effort: options.effort,
        },
        {
          model: options.model,
          signal: options.signal,
          timeoutMs: remaining,
          onTextDelta: (text) => options.onEvent?.({ type: 'text_delta', text }),
        },
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.kind === 'cancelled') return finish('cancelled', lastText, step);
        if (error.kind === 'timeout') return finish('timeout', lastText, step);
        return finish('error', lastText, step, error.message);
      }
      if (options.signal.aborted) return finish('cancelled', lastText, step);
      throw error;
    }
    modelCalls += 1;
    model = result.model.model;
    await options.onModelUsage?.(result.usage, result.model);

    const assistantItem: ConversationItem = {
      kind: 'assistant',
      providerContent: result.providerContent,
    };
    items.push(assistantItem);
    newItems.push(assistantItem);
    if (result.text.trim()) lastText = result.text;

    if (result.thinkingSummary) {
      trace.push({ type: 'thinking', step, summary: result.thinkingSummary });
      options.onEvent?.({ type: 'thinking', step, summary: result.thinkingSummary });
    }
    if (result.stopReason === 'refusal') {
      return finish(
        'refusal',
        result.text,
        step,
        `The model declined (${result.refusalCategory ?? 'no category'}).`,
      );
    }
    if (result.toolCalls.length === 0) return finish('completed', result.text, step);

    const results: Array<{ toolCallId: string; content: string; isError: boolean }> = [];
    for (const call of result.toolCalls) {
      const started = now();
      const tool = tools.get(call.name);
      const parsed = tool?.input.safeParse(call.input);
      const inputPreview = preview(parsed?.success ? parsed.data : call.input);
      options.onEvent?.({
        type: 'tool_started',
        step,
        toolCallId: call.id,
        tool: call.name,
        input: inputPreview,
      });

      let ok = false;
      let summary: string;
      let content: string;
      if (!tool) {
        summary = 'Unknown tool - refused';
        content = JSON.stringify({ error: `There is no tool called "${call.name}".` });
      } else if (!parsed?.success) {
        summary = 'Invalid input - refused';
        content = JSON.stringify({
          error: 'Invalid tool input',
          issues: parsed?.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? [],
        });
      } else {
        try {
          const output = await withTimeout(
            tool.execute(parsed.data as never, {
              signal: options.signal,
              userText: options.userText,
            }),
            tool.timeoutMs,
            options.signal,
          );
          ok = true;
          summary = output.summary;
          content = JSON.stringify(output.result);
        } catch (error) {
          const message =
            error instanceof ToolError ? error.message : 'The tool failed unexpectedly.';
          summary = `Failed: ${message}`;
          content = JSON.stringify({ error: message });
        }
      }
      const durationMs = now() - started;
      results.push({ toolCallId: call.id, content, isError: !ok });
      trace.push({
        type: 'tool',
        step,
        toolCallId: call.id,
        tool: call.name,
        input: inputPreview,
        ok,
        summary,
        durationMs,
      });
      options.onEvent?.({
        type: 'tool_finished',
        step,
        toolCallId: call.id,
        tool: call.name,
        ok,
        summary,
        durationMs,
      });
    }

    const resultsItem: ConversationItem = { kind: 'tool_results', results };
    items.push(resultsItem);
    newItems.push(resultsItem);
  }
  return finish('step_limit', lastText, options.maxSteps);
}
