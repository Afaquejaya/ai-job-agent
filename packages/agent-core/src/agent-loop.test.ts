import { ProviderError, type ModelProvider } from '@job-agent/ai-providers';
import { createScriptedProvider } from '@job-agent/ai-providers/testing';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  BudgetExceededError,
  runAgentTurn,
  ToolError,
  type AgentLoopEvent,
  type AgentTool,
  type AgentToolOutput,
  type RunAgentTurnOptions,
} from './agent-loop';

const echoTool = (
  execute: (input: { text: string }) => Promise<AgentToolOutput> = vi.fn(
    async (input: { text: string }) => ({ result: { echoed: input.text }, summary: 'echoed' }),
  ),
) =>
  ({
    name: 'echo',
    description: 'Echo text',
    input: z.object({ text: z.string().min(1) }).strict(),
    inputJsonSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    timeoutMs: 1000,
    execute,
  }) satisfies AgentTool<{ text: string }>;

const toolStep = (name: string, input: unknown, id = 'call_1') => ({
  stopReason: 'tool_use' as const,
  toolCalls: [{ id, name, input }],
  providerContent: [{ type: 'tool_use', id, name, input }],
});

function options(
  provider: ModelProvider,
  overrides: Partial<RunAgentTurnOptions> = {},
): RunAgentTurnOptions {
  return {
    provider,
    model: 'claude-opus-5-5',
    system: 'test',
    history: [],
    userText: 'hello',
    tools: [echoTool() as unknown as AgentTool<never>],
    maxSteps: 4,
    timeoutMs: 60_000,
    maxOutputTokens: 1000,
    effort: 'medium',
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('runAgentTurn', () => {
  it('answers directly when the model needs no tools', async () => {
    const provider = createScriptedProvider([{ text: 'Hi there' }]);
    const result = await runAgentTurn(options(provider));
    expect(result).toMatchObject({
      finalText: 'Hi there',
      stopReason: 'completed',
      modelCalls: 1,
      model: 'claude-opus-5-5',
    });
    expect(result.newItems.map((i) => i.kind)).toEqual(['user_text', 'assistant']);
  });

  it('runs a requested tool, returns its result to the model, and records every step', async () => {
    const execute = vi.fn(async (input: { text: string }) => ({
      result: { echoed: input.text },
      summary: 'echoed',
    }));
    const provider = createScriptedProvider([
      { ...toolStep('echo', { text: 'ping' }), thinkingSummary: 'I should echo' },
      { text: 'Done: ping' },
    ]);
    const events: AgentLoopEvent[] = [];
    const usage = vi.fn(async () => {});
    const result = await runAgentTurn(
      options(provider, {
        tools: [echoTool(execute) as unknown as AgentTool<never>],
        onEvent: (e) => events.push(e),
        onModelUsage: usage,
      }),
    );

    expect(execute).toHaveBeenCalledWith(
      { text: 'ping' },
      expect.objectContaining({ userText: 'hello' }),
    );
    expect(result).toMatchObject({
      finalText: 'Done: ping',
      stopReason: 'completed',
      modelCalls: 2,
    });
    expect(result.newItems.map((i) => i.kind)).toEqual([
      'user_text',
      'assistant',
      'tool_results',
      'assistant',
    ]);
    expect(result.newItems[2]).toEqual({
      kind: 'tool_results',
      results: [{ toolCallId: 'call_1', content: '{"echoed":"ping"}', isError: false }],
    });
    // The second model call saw the tool result.
    expect(provider.calls[1]!.items.at(-1)).toEqual(result.newItems[2]);
    expect(result.trace.map((t) => t.type)).toEqual(['thinking', 'tool']);
    expect(events.map((e) => e.type)).toEqual(['thinking', 'tool_started', 'tool_finished']);
    expect(usage).toHaveBeenCalledTimes(2);
  });

  it('refuses unknown tools and invalid input without running anything', async () => {
    const execute = vi.fn();
    const provider = createScriptedProvider([
      toolStep('delete_everything', {}, 'a'),
      toolStep('echo', { text: '', extra: true }, 'b'),
      { text: 'ok' },
    ]);
    const result = await runAgentTurn(
      options(provider, { tools: [echoTool(execute) as unknown as AgentTool<never>] }),
    );

    expect(execute).not.toHaveBeenCalled();
    const results = result.newItems.filter((i) => i.kind === 'tool_results');
    expect(results.map((r) => r.kind === 'tool_results' && r.results[0]!.isError)).toEqual([
      true,
      true,
    ]);
    expect(
      result.trace.filter((t) => t.type === 'tool').map((t) => t.type === 'tool' && t.summary),
    ).toEqual(['Unknown tool - refused', 'Invalid input - refused']);
  });

  it('passes ToolError messages to the model but hides unexpected errors', async () => {
    let calls = 0;
    const execute = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new ToolError('No CV uploaded');
      throw new Error('database password is hunter2');
    });
    const provider = createScriptedProvider([
      toolStep('echo', { text: 'a' }, 'a'),
      toolStep('echo', { text: 'b' }, 'b'),
      { text: 'ok' },
    ]);
    const result = await runAgentTurn(
      options(provider, { tools: [echoTool(execute) as unknown as AgentTool<never>] }),
    );
    const contents = result.newItems.flatMap((i) =>
      i.kind === 'tool_results' ? i.results.map((r) => r.content) : [],
    );
    expect(contents[0]).toContain('No CV uploaded');
    expect(contents[1]).toContain('The tool failed unexpectedly.');
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('times out a tool that does not finish', async () => {
    const slow = { ...echoTool(vi.fn(() => new Promise<never>(() => {}))), timeoutMs: 20 };
    const provider = createScriptedProvider([toolStep('echo', { text: 'a' }), { text: 'ok' }]);
    const result = await runAgentTurn(
      options(provider, { tools: [slow as unknown as AgentTool<never>] }),
    );
    expect(result.trace[0]).toMatchObject({
      type: 'tool',
      ok: false,
      summary: 'Failed: The tool did not finish within 0.02s',
    });
    expect(result.stopReason).toBe('completed');
  });

  it('stops at the step limit', async () => {
    const provider = createScriptedProvider([toolStep('echo', { text: 'again' })]);
    const result = await runAgentTurn(options(provider, { maxSteps: 3 }));
    expect(result.stopReason).toBe('step_limit');
    expect(result.modelCalls).toBe(3);
    expect(result.finalText).toMatch(/more steps than allowed/);
    expect(result.trace.at(-1)).toMatchObject({ type: 'limit' });
  });

  it('stops at the turn deadline', async () => {
    let clock = 0;
    const provider = createScriptedProvider([toolStep('echo', { text: 'a' })]);
    const execute = vi.fn(async () => {
      clock += 70_000;
      return { result: {}, summary: 'slow' };
    });
    const result = await runAgentTurn(
      options(provider, {
        now: () => clock,
        tools: [echoTool(execute) as unknown as AgentTool<never>],
      }),
    );
    expect(result.stopReason).toBe('timeout');
    expect(result.modelCalls).toBe(1);
  });

  it('stops before calling the model when the budget is used up', async () => {
    const provider = createScriptedProvider([{ text: 'never' }]);
    const result = await runAgentTurn(
      options(provider, {
        beforeModelCall: async () => {
          throw new BudgetExceededError('The monthly AI budget ($5.00) has been used up.');
        },
      }),
    );
    expect(provider.calls).toHaveLength(0);
    expect(result).toMatchObject({ stopReason: 'budget_exhausted', modelCalls: 0 });
    expect(result.trace[0]).toMatchObject({
      type: 'limit',
      reason: 'The monthly AI budget ($5.00) has been used up.',
    });
  });

  it('stops on a refusal and never runs tools from it', async () => {
    const execute = vi.fn();
    const provider = createScriptedProvider([
      { ...toolStep('echo', { text: 'a' }), stopReason: 'refusal', refusalCategory: 'cyber' },
    ]);
    const result = await runAgentTurn(
      options(provider, { tools: [echoTool(execute) as unknown as AgentTool<never>] }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('refusal');
    expect(result.finalText).toBe('The AI model declined this request.');
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createScriptedProvider([{ text: 'never' }]);
    const result = await runAgentTurn(options(provider, { signal: controller.signal }));
    expect(result.stopReason).toBe('cancelled');
    expect(provider.calls).toHaveLength(0);
  });

  it('reports provider failures as an error stop without throwing', async () => {
    const provider: ModelProvider = {
      id: 'anthropic',
      agentStep: async () => {
        throw new ProviderError('anthropic', 'auth', 'The Anthropic API key was rejected');
      },
      generateStructured: async () => {
        throw new Error('unused');
      },
    };
    const result = await runAgentTurn(options(provider));
    expect(result.stopReason).toBe('error');
    expect(result.trace[0]).toMatchObject({
      type: 'limit',
      reason: 'The Anthropic API key was rejected',
    });
  });

  it('replays history before the new message', async () => {
    const provider = createScriptedProvider([{ text: 'again' }]);
    const history = [
      { kind: 'user_text' as const, text: 'first' },
      { kind: 'assistant' as const, providerContent: [{ type: 'text', text: 'reply' }] },
    ];
    await runAgentTurn(options(provider, { history }));
    expect(provider.calls[0]!.items).toEqual([...history, { kind: 'user_text', text: 'hello' }]);
  });
});
