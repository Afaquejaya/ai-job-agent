import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InMemoryToolRegistry, type ToolDefinition } from './tools';

const echo: ToolDefinition<{ text: string }, { text: string }> = {
  name: 'echo_text',
  description: 'Returns its input.',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  sideEffect: 'none',
  timeoutMs: 1_000,
  execute: async (input) => input,
};

describe('InMemoryToolRegistry', () => {
  it('registers and lists tools without exposing their implementation', () => {
    const registry = new InMemoryToolRegistry();
    registry.register(echo as ToolDefinition<never, unknown>);
    expect(registry.list()).toEqual([
      { name: 'echo_text', description: 'Returns its input.', sideEffect: 'none' },
    ]);
    expect(registry.get('echo_text')).toBeDefined();
  });

  it('rejects duplicate and badly named tools', () => {
    const registry = new InMemoryToolRegistry();
    registry.register(echo as ToolDefinition<never, unknown>);
    expect(() => registry.register(echo as ToolDefinition<never, unknown>)).toThrow(/already/);
    expect(() =>
      registry.register({ ...echo, name: 'Bad Name' } as ToolDefinition<never, unknown>),
    ).toThrow(/snake_case/);
  });
});
