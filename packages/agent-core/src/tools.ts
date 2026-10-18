import type { Logger } from '@job-agent/observability';
import type { TaskId, UserId } from '@job-agent/shared';
import type { z } from 'zod';

/**
 * How far a tool reaches outside the system. The executor uses this to decide whether a
 * policy check, approval or checkpoint is required before calling it.
 */
export type ToolSideEffect =
  | 'none'
  | 'internal_write'
  | 'external_read'
  | 'external_write'
  /** e.g. submitting an application or sending an email. */
  | 'irreversible';

export interface ToolContext {
  userId: UserId;
  taskId: TaskId;
  /** Unique per (task, step, attempt) so a retried call can be recognised downstream. */
  idempotencyKey: string;
  signal: AbortSignal;
  logger: Logger;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  /** Stable snake_case name shown to the model, e.g. `search_jobs`. */
  name: string;
  description: string;
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  sideEffect: ToolSideEffect;
  timeoutMs: number;
  execute(input: Input, context: ToolContext): Promise<Output>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  sideEffect: ToolSideEffect;
}

export interface ToolRegistry {
  register(tool: ToolDefinition<never, unknown>): void;
  get(name: string): ToolDefinition<never, unknown> | undefined;
  list(): ToolDescriptor[];
}

export class InMemoryToolRegistry implements ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition<never, unknown>>();

  register(tool: ToolDefinition<never, unknown>): void {
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
      throw new Error(`Tool name must be snake_case: ${tool.name}`);
    }
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.#tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition<never, unknown> | undefined {
    return this.#tools.get(name);
  }

  list(): ToolDescriptor[] {
    return [...this.#tools.values()].map(({ name, description, sideEffect }) => ({
      name,
      description,
      sideEffect,
    }));
  }
}
