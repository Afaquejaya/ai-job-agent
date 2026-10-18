import type {
  AgentStepRequest,
  AgentStepResult,
  CallOptions,
  ModelProvider,
  StructuredRequest,
  StructuredResult,
  ToolCall,
} from '../types';

/**
 * Deterministic stand-in for a real model, for tests, CI and local development without an API
 * key. It never sends data anywhere. NOT for production (the web app refuses it there).
 */

const USAGE = { inputTokens: 1200, outputTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 };

function step(
  modelId: string,
  partial: Partial<Omit<AgentStepResult, 'model'>> = {},
): AgentStepResult {
  return {
    stopReason: 'end_turn',
    text: '',
    thinkingSummary: null,
    toolCalls: [],
    providerContent: [{ type: 'text', text: partial.text ?? '' }],
    usage: USAGE,
    refusalCategory: null,
    ...partial,
    model: { provider: 'anthropic', model: modelId },
  };
}

/** Replays a fixed list of steps (unit tests). Structured calls return `structured`. */
export function createScriptedProvider(
  steps: Array<Partial<Omit<AgentStepResult, 'model'>>>,
  structured?: unknown,
): ModelProvider & { calls: AgentStepRequest[] } {
  const calls: AgentStepRequest[] = [];
  let index = 0;
  return {
    id: 'anthropic',
    calls,
    async agentStep(request, options) {
      calls.push({ ...request, items: [...request.items] }); // snapshot: the loop keeps appending
      if (options.signal.aborted) throw new Error('aborted');
      const next = steps[Math.min(index++, steps.length - 1)] ?? {};
      return step(options.model, next);
    },
    async generateStructured<T>(request: StructuredRequest<T>, options: CallOptions) {
      return {
        parsed: request.schema.parse(structured),
        stopReason: 'end_turn',
        usage: USAGE,
        model: { provider: 'anthropic', model: options.model },
        refusalCategory: null,
      } satisfies StructuredResult<T>;
    },
  };
}

function lastUserText(request: AgentStepRequest): { text: string; afterIndex: number } {
  for (let i = request.items.length - 1; i >= 0; i--) {
    const item = request.items[i]!;
    if (item.kind === 'user_text') return { text: item.text, afterIndex: i };
  }
  return { text: '', afterIndex: -1 };
}

function toolResultsThisTurn(request: AgentStepRequest, afterIndex: number): Map<string, string> {
  const results = new Map<string, string>();
  const callNames = new Map<string, string>();
  for (const item of request.items.slice(afterIndex + 1)) {
    if (item.kind === 'assistant') {
      for (const block of item.providerContent as Array<{
        type: string;
        id?: string;
        name?: string;
      }>) {
        if (block.type === 'tool_use' && block.id && block.name)
          callNames.set(block.id, block.name);
      }
    }
    if (item.kind === 'tool_results') {
      for (const r of item.results)
        results.set(callNames.get(r.toolCallId) ?? r.toolCallId, r.content);
    }
  }
  return results;
}

function toolStep(model: string, thinking: string, call: ToolCall): AgentStepResult {
  return step(model, {
    stopReason: 'tool_use',
    thinkingSummary: thinking,
    toolCalls: [call],
    providerContent: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }],
  });
}

function section(prompt: string, tag: string): string {
  const match = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(prompt);
  return match?.[1] ?? '';
}

function firstLineContaining(text: string, needle: RegExp): string | null {
  return (
    text
      .split('\n')
      .find((line) => needle.test(line))
      ?.trim() ?? null
  );
}

/**
 * A "demo" fake that behaves like the real agent for the first-agent flow: a long pasted
 * message is saved as a job and analysed; a short one gets a hint. Its match analysis quotes
 * real lines from the CV and the job, plus ONE invented quote, so the evidence check can be
 * seen working (that factor must end up "unknown").
 */
export function createDemoFakeProvider(): ModelProvider {
  return {
    id: 'anthropic',

    async agentStep(request, options) {
      const model = options.model;
      const { text, afterIndex } = lastUserText(request);
      const done = toolResultsThisTurn(request, afterIndex);

      if (text.length < 200) {
        return step(model, {
          text: 'Paste a job description (and optionally its link) and I will compare it with your CV and profile, quoting the evidence.',
        });
      }
      if (!done.has('save_job_posting')) {
        const title =
          text
            .split('\n')
            .find((l) => l.trim().length > 0)
            ?.trim()
            .slice(0, 120) ?? 'Pasted job';
        return toolStep(model, 'The user pasted a job description. I will save it first.', {
          id: 'fake_call_save',
          name: 'save_job_posting',
          input: { title, company: 'Example Company', location: null, url: null },
        });
      }
      if (!done.has('analyze_job_match')) {
        const saved = JSON.parse(done.get('save_job_posting')!) as { jobId?: string };
        return toolStep(model, 'Job saved. Now I will analyse the match against the CV.', {
          id: 'fake_call_analyze',
          name: 'analyze_job_match',
          input: { jobId: saved.jobId ?? '' },
        });
      }
      const analysis = JSON.parse(done.get('analyze_job_match')!) as {
        score?: number | null;
        recommendation?: string;
      };
      const reply = `I analysed the job. Score: ${analysis.score ?? 'n/a'}/100 (${analysis.recommendation ?? 'unknown'}). See the Jobs page for every factor with its evidence.`;
      options.onTextDelta?.(reply);
      return step(model, {
        text: reply,
        thinkingSummary: 'Summarising the analysis for the user.',
      });
    },

    async generateStructured<T>(request: StructuredRequest<T>, options: CallOptions) {
      const cv = section(request.prompt, 'cv');
      const job = section(request.prompt, 'job');
      const jobSkills =
        firstLineContaining(job, /skill|sql|python|experience/i) ?? job.split('\n')[0] ?? '';
      const cvSkills = firstLineContaining(cv, /skill/i);
      const output = {
        factors: [
          {
            factor: 'skills',
            assessment: cvSkills ? 'partial' : 'unknown',
            mandatory: false,
            jobEvidence: jobSkills,
            cvEvidence: cvSkills,
            explanation: 'Compared the skills listed in the CV with the job requirements.',
          },
          {
            // Deliberately invented CV quote: the server must downgrade this to "unknown".
            factor: 'experience',
            assessment: 'meets',
            mandatory: false,
            jobEvidence: jobSkills,
            cvEvidence: '12 years leading teams at Imaginary Corp',
            explanation: 'Invented by the fake model to exercise the evidence check.',
          },
        ],
        gaps: ['The CV does not mention all tools the job lists.'],
        summary: 'Demo analysis produced by the fake provider (no real AI was used).',
      };
      return {
        parsed: request.schema.parse(output),
        stopReason: 'end_turn',
        usage: { ...USAGE, outputTokens: 400 },
        model: { provider: 'anthropic', model: options.model },
        refusalCategory: null,
      } satisfies StructuredResult<T>;
    },
  };
}
