'use client';

import {
  AGENT_LIMITS,
  type AgentChatMessage,
  type AgentConversationSummary,
  type AgentStreamEvent,
  type AgentTraceEntry,
  type AiUsageStatus,
} from '@job-agent/shared';
import { useRef, useState, type FormEvent } from 'react';
import { AiConsent } from '@/components/ai/ai-consent';
import { apiErrorMessage, apiErrorReason } from '@/components/ui/api-error';
import { Alert, Badge, Button, fieldClass } from '@/components/ui/form';

const TOOL_LABELS: Record<string, string> = {
  get_my_profile: 'Read your profile',
  get_my_verified_answers: 'Read your verified answers',
  get_primary_cv_text: 'Read your primary CV',
  save_job_posting: 'Save the job',
  list_saved_jobs: 'List your saved jobs',
  analyze_job_match: 'Analyse the match',
};

const usd = (value: number) => `$${value.toFixed(value < 1 ? 4 : 2)}`;

/** A step that is still running has no result yet. */
type LiveStep =
  AgentTraceEntry | { type: 'running'; step: number; toolCallId: string; tool: string };

function StepList({ steps }: { steps: LiveStep[] }) {
  return (
    <ol className="flex flex-col gap-2 text-xs">
      {steps.map((entry, index) => (
        <li key={index} className="flex gap-2">
          <span className="w-12 shrink-0 text-zinc-500">step {entry.step}</span>
          {entry.type === 'thinking' ? (
            <span className="whitespace-pre-wrap text-zinc-600 italic dark:text-zinc-400">
              Thinking: {entry.summary}
            </span>
          ) : entry.type === 'running' ? (
            <span>
              <span className="font-medium">{TOOL_LABELS[entry.tool] ?? entry.tool}</span>
              <span className="text-zinc-500"> · running…</span>
            </span>
          ) : entry.type === 'tool' ? (
            <span>
              <span className="font-medium">{TOOL_LABELS[entry.tool] ?? entry.tool}</span>{' '}
              <Badge tone={entry.ok ? 'success' : 'danger'}>{entry.ok ? 'ok' : 'failed'}</Badge>{' '}
              <span className="text-zinc-600 dark:text-zinc-400">{entry.summary}</span>
              <span className="text-zinc-400"> · {(entry.durationMs / 1000).toFixed(1)}s</span>
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">Stopped: {entry.reason}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function MessageBubble({ message }: { message: AgentChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="ml-8 self-end rounded-xl bg-blue-600 px-4 py-2 text-sm whitespace-pre-wrap text-white">
        {message.content.length > 1500 ? `${message.content.slice(0, 1500)}…` : message.content}
      </div>
    );
  }
  return (
    <div className="mr-8 flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="whitespace-pre-wrap">{message.content}</div>
      {message.trace.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500">
            How I got here ({message.trace.filter((t) => t.type === 'tool').length} tool steps)
          </summary>
          <div className="mt-2">
            <StepList steps={message.trace} />
          </div>
        </details>
      ) : null}
      <p className="text-xs text-zinc-400">
        {message.model ?? ''}
        {message.costUsd !== null ? ` · ${usd(message.costUsd)}` : ''}
        {message.stopReason && message.stopReason !== 'completed'
          ? ` · stopped: ${message.stopReason.replace(/_/g, ' ')}`
          : ''}
      </p>
    </div>
  );
}

export function AgentClient({
  initialUsage,
  initialConversations,
}: {
  initialUsage: AiUsageStatus;
  initialConversations: AgentConversationSummary[];
}) {
  const [usage, setUsage] = useState(initialUsage);
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [liveText, setLiveText] = useState('');
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ready = usage.configured && usage.consentGiven;

  async function refreshConversations() {
    const response = await fetch('/api/agent/conversations');
    if (response.ok) {
      const body = (await response.json()) as { conversations: AgentConversationSummary[] };
      setConversations(body.conversations);
    }
  }

  async function openConversation(id: string) {
    if (pending) return;
    setError(null);
    const response = await fetch(`/api/agent/conversations/${id}`);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setError(apiErrorMessage(body, 'Could not open the conversation.'));
      return;
    }
    setConversationId(id);
    setMessages((body as { messages: AgentChatMessage[] }).messages);
  }

  async function deleteConversation(id: string) {
    if (!window.confirm('Delete this conversation? Saved jobs and match results are kept.')) return;
    const response = await fetch(`/api/agent/conversations/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Could not delete the conversation.');
      return;
    }
    if (conversationId === id) startNew();
    setConversations((list) => list.filter((c) => c.id !== id));
  }

  function startNew() {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }

  function handleEvent(event: AgentStreamEvent, userText: string) {
    switch (event.type) {
      case 'turn_started':
        setConversationId(event.conversationId);
        setMessages((list) => [
          ...list,
          {
            id: event.userMessageId,
            role: 'user',
            content: userText,
            trace: [],
            stopReason: null,
            model: null,
            costUsd: null,
            createdAt: new Date().toISOString(),
          },
        ]);
        break;
      case 'thinking':
        setLiveSteps((steps) => [
          ...steps,
          { type: 'thinking', step: event.step, summary: event.summary },
        ]);
        setLiveText('');
        break;
      case 'tool_started':
        setLiveSteps((steps) => [
          ...steps,
          { type: 'running', step: event.step, toolCallId: event.toolCallId, tool: event.tool },
        ]);
        setLiveText('');
        break;
      case 'tool_finished':
        setLiveSteps((steps) =>
          steps.map((s) =>
            s.type === 'running' && s.toolCallId === event.toolCallId
              ? {
                  type: 'tool',
                  step: event.step,
                  toolCallId: event.toolCallId,
                  tool: event.tool,
                  input: '',
                  ok: event.ok,
                  summary: event.summary,
                  durationMs: event.durationMs,
                }
              : s,
          ),
        );
        break;
      case 'text_delta':
        setLiveText((text) => text + event.text);
        break;
      case 'turn_finished':
        setMessages((list) => [...list, event.message]);
        setUsage((u) => ({ ...u, monthToDateUsd: u.monthToDateUsd + event.usage.costUsd }));
        break;
      case 'error':
        setError(event.message);
        break;
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    setLiveSteps([]);
    setLiveText('');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/agent/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body: unknown = await response.json().catch(() => null);
        if (apiErrorReason(body) === 'consent_required')
          setUsage((u) => ({ ...u, consentGiven: false }));
        setError(apiErrorMessage(body, 'The agent could not start.'));
        return;
      }
      setInput('');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handleEvent(JSON.parse(line) as AgentStreamEvent, text);
          newline = buffer.indexOf('\n');
        }
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError('The connection was interrupted. Reload the conversation to see what was saved.');
      }
    } finally {
      setPending(false);
      setLiveSteps([]);
      setLiveText('');
      abortRef.current = null;
      void refreshConversations();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span>
          Model: {usage.model ?? 'not configured'} ({usage.provider})
        </span>
        {usage.runsLocally ? (
          <span>Runs on this computer: free, and nothing leaves your machine</span>
        ) : (
          <span>
            This month: {usd(usage.monthToDateUsd)}
            {usage.monthlyBudgetUsd !== null ? ` of ${usd(usage.monthlyBudgetUsd)} budget` : ''}
          </span>
        )}
      </div>

      {!usage.configured ? (
        <Alert tone="error">AI is not available: {usage.unavailableReason}</Alert>
      ) : null}
      {usage.configured && !usage.consentGiven ? (
        <AiConsent
          consentGiven={false}
          runsLocally={usage.runsLocally}
          onChange={(consentGiven) => setUsage((u) => ({ ...u, consentGiven }))}
        />
      ) : null}

      {conversations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button size="sm" variant="secondary" onClick={startNew} disabled={pending}>
            New conversation
          </Button>
          {conversations.map((c) => (
            <span
              key={c.id}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${c.id === conversationId ? 'border-blue-500' : 'border-zinc-300 dark:border-zinc-700'}`}
            >
              <button
                type="button"
                onClick={() => void openConversation(c.id)}
                className="max-w-48 truncate"
              >
                {c.title}
              </button>
              <button
                type="button"
                aria-label={`Delete conversation ${c.title}`}
                onClick={() => void deleteConversation(c.id)}
                className="text-zinc-400 hover:text-red-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3" aria-live="polite">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {pending ? (
          <div className="mr-8 flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm dark:border-zinc-700">
            <p className="text-xs font-medium text-zinc-500">
              {usage.runsLocally
                ? 'Working… The model runs on your computer, so this can take a few minutes.'
                : 'Working…'}
            </p>
            {liveSteps.length > 0 ? <StepList steps={liveSteps} /> : null}
            {liveText ? <div className="whitespace-pre-wrap">{liveText}</div> : null}
          </div>
        ) : null}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <form onSubmit={send} className="flex flex-col gap-2">
        <label htmlFor="agent-input" className="sr-only">
          Message
        </label>
        <textarea
          id="agent-input"
          rows={6}
          className={fieldClass}
          placeholder="Paste a job description here (title, company, location, link and the full text), or ask about your saved jobs."
          value={input}
          maxLength={AGENT_LIMITS.maxUserMessageChars}
          onChange={(e) => setInput(e.target.value)}
          disabled={!ready || pending}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={!ready || pending || !input.trim()}>
            {pending ? 'Working…' : 'Send'}
          </Button>
          {pending ? (
            <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
