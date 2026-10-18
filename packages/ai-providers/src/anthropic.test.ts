import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAnthropicProvider, prepareEchoContent, type AnthropicClientLike } from './anthropic';
import { estimateCostUsd, hasPrice } from './pricing';
import { ProviderError, type AgentStepRequest, type CallOptions } from './types';

/** A fake Anthropic client: records request params and returns canned messages or errors. */
function fakeClient(responses: Array<Record<string, unknown> | Error>) {
  const params: Array<Record<string, unknown>> = [];
  let index = 0;
  const next = () => {
    const response = responses[Math.min(index++, responses.length - 1)];
    if (response instanceof Error) throw response;
    return {
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      stop_details: null,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      content: [],
      ...response,
    };
  };
  const client = {
    beta: {
      messages: {
        stream(p: Record<string, unknown>) {
          params.push(p);
          const listeners: Array<(delta: string) => void> = [];
          return {
            on(_event: 'text', listener: (delta: string) => void) {
              listeners.push(listener);
              return this;
            },
            async finalMessage() {
              const message = next();
              for (const block of message.content as Array<{ type: string; text?: string }>) {
                if (block.type === 'text') listeners.forEach((l) => l(block.text ?? ''));
              }
              return message;
            },
          };
        },
        async parse(p: Record<string, unknown>) {
          params.push(p);
          return next();
        },
      },
    },
  } as unknown as AnthropicClientLike;
  return { client, params };
}

const request: AgentStepRequest = {
  purpose: 'chat',
  system: 'You are a test.',
  items: [{ kind: 'user_text', text: 'Hello' }],
  tools: [
    {
      name: 'list_saved_jobs',
      description: 'List jobs',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ],
  maxOutputTokens: 1000,
  effort: 'medium',
};
const call = (): CallOptions => ({
  model: 'claude-opus-5-5',
  signal: new AbortController().signal,
  timeoutMs: 5000,
});

describe('prepareEchoContent', () => {
  it('echoes content unchanged when there was no fallback', () => {
    const content = [
      { type: 'thinking', thinking: 'x', signature: 's' },
      { type: 'tool_use', id: 't1', name: 'a', input: {} },
    ];
    expect(prepareEchoContent(content as never)).toBe(content);
  });

  it('drops model-internal blocks before the last fallback and keeps text', () => {
    const content = [
      { type: 'thinking', thinking: 'declined model', signature: 's1' },
      { type: 'text', text: 'partial' },
      { type: 'tool_use', id: 't0', name: 'a', input: {} },
      { type: 'fallback' },
      { type: 'thinking', thinking: 'fallback model', signature: 's2' },
      { type: 'tool_use', id: 't1', name: 'a', input: {} },
    ];
    expect(prepareEchoContent(content as never).map((b) => (b as { type: string }).type)).toEqual([
      'text',
      'fallback',
      'thinking',
      'tool_use',
    ]);
  });
});

describe('createAnthropicProvider.agentStep', () => {
  it('sends strict, eagerly streamed tools with adaptive thinking, effort, caching and fallbacks', async () => {
    const { client, params } = fakeClient([{ content: [{ type: 'text', text: 'Hi' }] }]);
    const deltas: string[] = [];
    const result = await createAnthropicProvider({ client }).agentStep(request, {
      ...call(),
      onTextDelta: (d) => deltas.push(d),
    });

    const sent = params[0]!;
    expect(sent).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: 'You are a test.',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect((sent.tools as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'list_saved_jobs',
      strict: true,
      eager_input_streaming: true,
    });
    expect(result).toMatchObject({ stopReason: 'end_turn', text: 'Hi', toolCalls: [] });
    expect(deltas).toEqual(['Hi']);
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('returns tool calls only from the final model segment, and only on tool_use', async () => {
    const { client } = fakeClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'old', name: 'list_saved_jobs', input: {} },
          { type: 'fallback' },
          { type: 'thinking', thinking: 'Checking jobs', signature: 's' },
          { type: 'tool_use', id: 'new', name: 'list_saved_jobs', input: {} },
        ],
      },
      {
        stop_reason: 'max_tokens',
        content: [{ type: 'tool_use', id: 'cut', name: 'list_saved_jobs', input: {} }],
      },
    ]);
    const provider = createAnthropicProvider({ client });
    const first = await provider.agentStep(request, call());
    expect(first.toolCalls.map((c) => c.id)).toEqual(['new']);
    expect(first.thinkingSummary).toBe('Checking jobs');

    const truncated = await provider.agentStep(request, call());
    expect(truncated.stopReason).toBe('max_tokens');
    expect(truncated.toolCalls).toEqual([]);
  });

  it('reports refusals with their category', async () => {
    const { client } = fakeClient([
      { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] },
    ]);
    const result = await createAnthropicProvider({ client }).agentStep(request, call());
    expect(result).toMatchObject({
      stopReason: 'refusal',
      refusalCategory: 'cyber',
      toolCalls: [],
    });
  });

  it('replays earlier turns: tool results go back in one user message', async () => {
    const { client, params } = fakeClient([{ content: [{ type: 'text', text: 'Done' }] }]);
    await createAnthropicProvider({ client }).agentStep(
      {
        ...request,
        items: [
          { kind: 'user_text', text: 'Hello' },
          {
            kind: 'assistant',
            providerContent: [{ type: 'tool_use', id: 't1', name: 'list_saved_jobs', input: {} }],
          },
          { kind: 'tool_results', results: [{ toolCallId: 't1', content: '[]', isError: false }] },
        ],
      },
      call(),
    );
    expect(params[0]!.messages).toEqual([
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'list_saved_jobs', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]', is_error: false }],
      },
    ]);
  });

  it('re-issues a step whose tool input could not be parsed, a bounded number of times', async () => {
    const { client, params } = fakeClient([
      new SyntaxError('Unexpected end of JSON input'),
      { content: [{ type: 'text', text: 'ok' }] },
    ]);
    const result = await createAnthropicProvider({ client }).agentStep(request, call());
    expect(result.text).toBe('ok');
    expect(params).toHaveLength(2);

    const failing = fakeClient([new SyntaxError('bad json')]);
    await expect(
      createAnthropicProvider({ client: failing.client }).agentStep(request, call()),
    ).rejects.toThrow('bad json');
    expect(failing.params).toHaveLength(3);
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [529, 'unavailable'],
    [400, 'invalid_request'],
  ])('maps HTTP %i to a ProviderError of kind %s without retrying', async (status, kind) => {
    const error = Anthropic.APIError.generate(
      status,
      { error: { message: 'x' } },
      'x',
      new Headers({ 'retry-after': '7' }),
    );
    const { client, params } = fakeClient([error]);
    const failure = await createAnthropicProvider({ client })
      .agentStep(request, call())
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).kind).toBe(kind);
    if (kind === 'rate_limited') expect((failure as ProviderError).retryAfterMs).toBe(7000);
    expect(params).toHaveLength(1);
  });

  it('maps a user abort to cancelled', async () => {
    const { client } = fakeClient([new Anthropic.APIUserAbortError()]);
    await expect(
      createAnthropicProvider({ client }).agentStep(request, call()),
    ).rejects.toMatchObject({
      kind: 'cancelled',
    });
  });
});

describe('createAnthropicProvider.generateStructured', () => {
  it('requests structured output and returns the parsed value', async () => {
    const { client, params } = fakeClient([{ parsed_output: { ok: true } }]);
    const result = await createAnthropicProvider({ client }).generateStructured(
      {
        purpose: 'job_matching',
        system: 'sys',
        prompt: 'go',
        schema: z.object({ ok: z.boolean() }),
        maxOutputTokens: 500,
        effort: 'high',
      },
      call(),
    );
    expect(result.parsed).toEqual({ ok: true });
    expect(params[0]).toMatchObject({
      output_config: { effort: 'high', format: { type: 'json_schema' } },
    });
  });

  it('never returns parsed output from a refusal', async () => {
    const { client } = fakeClient([{ stop_reason: 'refusal', parsed_output: { ok: true } }]);
    const result = await createAnthropicProvider({ client }).generateStructured(
      {
        purpose: 'job_matching',
        system: 's',
        prompt: 'p',
        schema: z.object({ ok: z.boolean() }),
        maxOutputTokens: 10,
        effort: 'low',
      },
      call(),
    );
    expect(result).toMatchObject({ parsed: null, stopReason: 'refusal' });
  });
});

describe('pricing', () => {
  it('prices Opus 5.5 at $4 / $20 per million tokens, cache reads at $0.20', () => {
    expect(
      estimateCostUsd('claude-opus-5-5', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      }),
    ).toBeCloseTo(24.2, 6);
  });

  it('charges unknown models at the most expensive known rate', () => {
    expect(hasPrice('some-future-model')).toBe(false);
    const usage = {
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    expect(estimateCostUsd('some-future-model', usage)).toBeGreaterThanOrEqual(
      estimateCostUsd('claude-opus-5-5', usage),
    );
  });
});
