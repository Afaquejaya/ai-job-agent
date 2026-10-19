import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createOllamaProvider, isLoopbackUrl, toOllamaMessages } from './ollama';
import { estimateCallCostUsd } from './pricing';
import { ProviderError, type AgentStepRequest, type CallOptions } from './types';

const BASE = 'http://127.0.0.1:11434';

/** A fake fetch that streams the given chunks as NDJSON and records request bodies. */
function fakeFetch(...responses: Array<unknown[] | { status: number; body: string } | Error>) {
  const bodies: Array<Record<string, unknown>> = [];
  let index = 0;
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses[Math.min(index++, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    if (!Array.isArray(next)) return new Response(next.body, { status: next.status });
    const text = next.map((c) => JSON.stringify(c)).join('\n') + '\n';
    return new Response(
      new ReadableStream({
        start(controller) {
          // Split mid-line to prove partial chunks are reassembled.
          const half = Math.floor(text.length / 2);
          controller.enqueue(new TextEncoder().encode(text.slice(0, half)));
          controller.enqueue(new TextEncoder().encode(text.slice(half)));
          controller.close();
        },
      }),
      { status: 200 },
    );
  });
  return { fetch: fn as unknown as typeof fetch, bodies };
}

const done = (extra: Record<string, unknown> = {}) => ({
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 1200,
  prompt_eval_cached_count: 200,
  eval_count: 80,
  ...extra,
});

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
  maxOutputTokens: 4000,
  effort: 'medium',
};
const call = (overrides: Partial<CallOptions> = {}): CallOptions => ({
  model: 'bonsai-2:9b',
  signal: new AbortController().signal,
  timeoutMs: 5000,
  ...overrides,
});

describe('isLoopbackUrl', () => {
  it('accepts only this computer', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://localhost:11434/')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:11434')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.20:11434')).toBe(false);
    expect(isLoopbackUrl('https://ollama.example.com')).toBe(false);
    expect(isLoopbackUrl('http://localhost.evil.test')).toBe(false);
    expect(isLoopbackUrl('file:///etc/passwd')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });

  it('refuses to create a provider for another machine', () => {
    expect(() => createOllamaProvider({ baseUrl: 'http://10.0.0.5:11434' })).toThrow(
      /this computer/,
    );
  });
});

describe('toOllamaMessages', () => {
  it('maps the conversation, naming each tool result after its call', () => {
    const messages = toOllamaMessages('sys', [
      { kind: 'user_text', text: 'Hi' },
      {
        kind: 'assistant',
        providerContent: {
          provider: 'ollama',
          content: '',
          toolCalls: [{ id: 'c1', name: 'list_saved_jobs', arguments: {} }],
        },
      },
      { kind: 'tool_results', results: [{ toolCallId: 'c1', content: '[]', isError: false }] },
    ]);
    expect(messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'list_saved_jobs', arguments: {} } }],
      },
      { role: 'tool', tool_name: 'list_saved_jobs', content: '[]' },
    ]);
  });
});

describe('createOllamaProvider.agentStep', () => {
  it('streams text and thinking, asks for a large context, and reports usage', async () => {
    const { fetch, bodies } = fakeFetch([
      { message: { role: 'assistant', content: '', thinking: 'Let me ' } },
      { message: { role: 'assistant', content: '', thinking: 'think.' } },
      { message: { role: 'assistant', content: 'Hello ' } },
      { message: { role: 'assistant', content: 'there' } },
      done(),
    ]);
    const deltas: string[] = [];
    const result = await createOllamaProvider({ baseUrl: BASE, fetch }).agentStep(request, {
      ...call(),
      onTextDelta: (d) => deltas.push(d),
    });

    expect(bodies[0]).toMatchObject({
      model: 'bonsai-2:9b',
      stream: true,
      think: true,
      options: { num_ctx: 16384, num_predict: 4000 },
      tools: [{ type: 'function', function: { name: 'list_saved_jobs' } }],
    });
    expect(result).toMatchObject({
      stopReason: 'end_turn',
      text: 'Hello there',
      thinkingSummary: 'Let me think.',
      toolCalls: [],
      model: { provider: 'ollama', model: 'bonsai-2:9b' },
    });
    expect(deltas).toEqual(['Hello ', 'there']);
    expect(result.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 80,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
    });
    expect(estimateCallCostUsd(result.model, result.usage)).toBe(0);
  });

  it('returns tool calls with ids, and replays them so results can be matched', async () => {
    const { fetch } = fakeFetch([
      {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'list_saved_jobs', arguments: {} } }],
        },
      },
      done(),
    ]);
    const result = await createOllamaProvider({ baseUrl: BASE, fetch }).agentStep(request, call());
    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toHaveLength(1);
    const id = result.toolCalls[0]!.id;
    expect(id).toMatch(/^ollama_/);
    const replay = toOllamaMessages('s', [
      { kind: 'assistant', providerContent: result.providerContent },
      { kind: 'tool_results', results: [{ toolCallId: id, content: '{}', isError: false }] },
    ]);
    expect(replay.at(-1)).toEqual({ role: 'tool', tool_name: 'list_saved_jobs', content: '{}' });
  });

  it('asks again without thinking when the model does not support it, and remembers', async () => {
    const { fetch, bodies } = fakeFetch(
      { status: 400, body: JSON.stringify({ error: '"bonsai-2:9b" does not support thinking' }) },
      [{ message: { content: 'ok' } }, done()],
      [{ message: { content: 'again' } }, done()],
    );
    const provider = createOllamaProvider({ baseUrl: BASE, fetch });
    expect((await provider.agentStep(request, call())).text).toBe('ok');
    expect((await provider.agentStep(request, call())).text).toBe('again');
    expect(bodies.map((b) => b.think)).toEqual([true, false, false]);
  });

  it('reports a truncated answer as max_tokens', async () => {
    const { fetch } = fakeFetch([{ message: { content: 'cut' } }, done({ done_reason: 'length' })]);
    const result = await createOllamaProvider({ baseUrl: BASE, fetch }).agentStep(request, call());
    expect(result.stopReason).toBe('max_tokens');
  });

  it('explains when Ollama is not running', async () => {
    const { fetch } = fakeFetch(new TypeError('fetch failed'));
    const error = await createOllamaProvider({ baseUrl: BASE, fetch })
      .agentStep(request, call())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      kind: 'unavailable',
      message: expect.stringMatching(/not running/),
    });
  });

  it('explains when the model is not downloaded', async () => {
    const { fetch } = fakeFetch({
      status: 404,
      body: JSON.stringify({ error: "model 'bonsai-2:9b' not found" }),
    });
    await expect(
      createOllamaProvider({ baseUrl: BASE, fetch }).agentStep(request, call()),
    ).rejects.toMatchObject({
      kind: 'invalid_request',
      message: 'The model "bonsai-2:9b" is not downloaded. Run: ollama pull bonsai-2:9b',
    });
  });

  it('maps cancellation and timeouts', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(
      createOllamaProvider({ baseUrl: BASE, fetch: fakeFetch(abortError).fetch }).agentStep(
        request,
        call({ signal: aborted.signal }),
      ),
    ).rejects.toMatchObject({ kind: 'cancelled' });

    const timeoutError = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    await expect(
      createOllamaProvider({ baseUrl: BASE, fetch: fakeFetch(timeoutError).fetch }).agentStep(
        request,
        call(),
      ),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('surfaces an error reported inside the stream', async () => {
    const { fetch } = fakeFetch([{ error: 'out of memory' }]);
    await expect(
      createOllamaProvider({ baseUrl: BASE, fetch }).agentStep(request, call()),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'Ollama: out of memory',
    });
  });
});

describe('createOllamaProvider.generateStructured', () => {
  const schema = z.object({ ok: z.boolean(), items: z.array(z.string()) });
  const structured = (content: string) => [{ message: { content } }, done()];

  it('sends the JSON Schema as the format and returns the validated answer', async () => {
    const { fetch, bodies } = fakeFetch(structured('{"ok":true,"items":["a"]}'));
    const result = await createOllamaProvider({ baseUrl: BASE, fetch }).generateStructured(
      {
        purpose: 'job_matching',
        system: 's',
        prompt: 'p',
        schema,
        maxOutputTokens: 900,
        effort: 'high',
      },
      call(),
    );
    expect(result.parsed).toEqual({ ok: true, items: ['a'] });
    expect(bodies[0]).toMatchObject({
      think: false,
      format: { type: 'object', required: ['ok', 'items'] },
      options: { num_ctx: 16384, num_predict: 900, temperature: 0 },
    });
  });

  it('returns null for invalid JSON or an answer that does not match the schema', async () => {
    for (const content of ['not json', '{"ok":"yes","items":[]}']) {
      const { fetch } = fakeFetch(structured(content));
      const result = await createOllamaProvider({ baseUrl: BASE, fetch }).generateStructured(
        {
          purpose: 'job_matching',
          system: 's',
          prompt: 'p',
          schema,
          maxOutputTokens: 900,
          effort: 'high',
        },
        call(),
      );
      expect(result.parsed).toBeNull();
    }
  });
});
