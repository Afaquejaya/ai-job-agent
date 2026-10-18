import type { TaskId, UserId } from '@job-agent/shared';
import type { FailureKind } from './recovery';

/**
 * The agent loop, expressed as an interface so the engine behind it (a hand-written loop,
 * LangGraph.js, ...) can change without touching callers.
 *
 *   goal -> plan -> [choose tool -> execute -> observe]* -> final response
 *
 * The orchestrator only proposes actions. The executor validates each proposal against the
 * tool registry, the policy engine and the task state machine before anything runs.
 */
export interface AgentGoal {
  userId: UserId;
  taskId: TaskId;
  /** The user's request in natural language, or a scheduled goal such as the daily run. */
  instruction: string;
}

export interface PlanStep {
  id: string;
  tool: string;
  input: unknown;
  /** Short explanation shown in task history so the user can see why a step ran. */
  rationale: string;
}

export interface Observation {
  stepId: string;
  tool: string;
  ok: boolean;
  output?: unknown;
  error?: { kind: FailureKind; message: string };
  observedAt: Date;
}

export type NextAction =
  | { type: 'call_tool'; step: PlanStep }
  | { type: 'ask_user'; question: string }
  | { type: 'finish'; summary: string };

export interface OrchestratorState {
  goal: AgentGoal;
  observations: readonly Observation[];
  /** Hard cap on loop iterations; the executor stops the loop when it is reached. */
  remainingSteps: number;
}

export interface AgentOrchestrator {
  next(state: OrchestratorState, signal: AbortSignal): Promise<NextAction>;
}
