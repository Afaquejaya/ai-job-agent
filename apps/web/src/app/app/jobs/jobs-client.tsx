'use client';

import {
  JOB_DESCRIPTION_LIMITS,
  type AiUsageStatus,
  type JobPostingDetail,
  type JobPostingSummary,
  type MatchAnalysis,
} from '@job-agent/shared';
import { useState, type FormEvent } from 'react';
import { AiConsent } from '@/components/ai/ai-consent';
import { MatchCard, RecommendationBadge } from '@/components/jobs/match-card';
import { apiErrorMessage } from '@/components/ui/api-error';
import { Alert, Button, Field, TextArea, TextInput } from '@/components/ui/form';

const EMPTY_FORM = { title: '', company: '', location: '', url: '', description: '' };

function AddJobForm({ onSaved }: { onSaved: (id: string) => void }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        company: form.company,
        location: form.location.trim() || null,
        url: form.url.trim() || null,
        description: form.description,
      }),
    });
    setPending(false);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setError(apiErrorMessage(body, 'Could not save the job.'));
      return;
    }
    setForm(EMPTY_FORM);
    onSaved((body as { job: { id: string } }).job.id);
  }

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title">
          <TextInput required value={form.title} onChange={(e) => set('title')(e.target.value)} />
        </Field>
        <Field label="Company">
          <TextInput
            required
            value={form.company}
            onChange={(e) => set('company')(e.target.value)}
          />
        </Field>
        <Field label="Location (optional)">
          <TextInput value={form.location} onChange={(e) => set('location')(e.target.value)} />
        </Field>
        <Field label="Link (optional, reference only)">
          <TextInput type="url" value={form.url} onChange={(e) => set('url')(e.target.value)} />
        </Field>
      </div>
      <Field
        label="Job description"
        hint={`Paste the full text (${JOB_DESCRIPTION_LIMITS.min}–${JOB_DESCRIPTION_LIMITS.max.toLocaleString('en')} characters). ${form.description.length.toLocaleString('en')} so far.`}
      >
        <TextArea
          required
          rows={8}
          maxLength={JOB_DESCRIPTION_LIMITS.max}
          value={form.description}
          onChange={(e) => set('description')(e.target.value)}
        />
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save job'}
      </Button>
    </form>
  );
}

export function JobsClient({
  initialJobs,
  initialUsage,
}: {
  initialJobs: JobPostingSummary[];
  initialUsage: AiUsageStatus;
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [usage, setUsage] = useState(initialUsage);
  const [selected, setSelected] = useState<JobPostingDetail | null>(null);
  const [adding, setAdding] = useState(initialJobs.length === 0);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshList() {
    const response = await fetch('/api/jobs');
    if (response.ok) setJobs(((await response.json()) as { jobs: JobPostingSummary[] }).jobs);
  }

  async function open(id: string) {
    setError(null);
    const response = await fetch(`/api/jobs/${id}`);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setError(apiErrorMessage(body, 'Could not open the job.'));
      return;
    }
    setSelected((body as { job: JobPostingDetail }).job);
  }

  async function analyze(job: JobPostingDetail) {
    setAnalyzing(true);
    setError(null);
    const response = await fetch(`/api/jobs/${job.id}/analyze`, { method: 'POST' });
    setAnalyzing(false);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setError(apiErrorMessage(body, 'The analysis failed.'));
      return;
    }
    const match = (body as { match: MatchAnalysis }).match;
    setSelected({ ...job, match });
    void refreshList();
    const status = await fetch('/api/ai/usage');
    if (status.ok) setUsage(((await status.json()) as { usage: AiUsageStatus }).usage);
  }

  async function remove(job: JobPostingDetail) {
    if (!window.confirm(`Delete "${job.title}" and its match results?`)) return;
    const response = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Could not delete the job.');
      return;
    }
    setSelected(null);
    setJobs((list) => list.filter((j) => j.id !== job.id));
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {selected ? (
        <section className="flex flex-col gap-4">
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setSelected(null)}
          >
            ← All jobs
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{selected.title}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {selected.company}
              {selected.location ? ` · ${selected.location}` : ''}
              {selected.url ? (
                <>
                  {' · '}
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-blue-600 underline dark:text-blue-400"
                  >
                    original posting
                  </a>
                </>
              ) : null}
            </p>
          </div>

          {!usage.configured ? (
            <Alert tone="error">AI is not available: {usage.unavailableReason}</Alert>
          ) : !usage.consentGiven ? (
            <AiConsent
              consentGiven={false}
              runsLocally={usage.runsLocally}
              onChange={(consentGiven) => setUsage((u) => ({ ...u, consentGiven }))}
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={analyzing || !usage.configured || !usage.consentGiven}
              onClick={() => void analyze(selected)}
            >
              {analyzing
                ? usage.runsLocally
                  ? 'Analysing on your computer… (can take several minutes)'
                  : 'Analysing… (up to a minute)'
                : selected.match
                  ? 'Analyse again'
                  : 'Analyse match'}
            </Button>
            <Button variant="danger" onClick={() => void remove(selected)}>
              Delete job
            </Button>
          </div>

          {selected.match ? (
            <MatchCard match={selected.match} />
          ) : (
            <p className="text-sm text-zinc-500">Not analysed yet.</p>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Job description as pasted</summary>
            <p className="mt-2 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
              {selected.description}
            </p>
          </details>
        </section>
      ) : (
        <>
          {jobs.length > 0 ? (
            <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => void open(job.id)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <span className="font-medium">{job.title}</span>
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      {job.company}
                      {job.location ? ` · ${job.location}` : ''}
                    </span>
                    <span className="ml-auto">
                      {job.latestMatch ? (
                        <RecommendationBadge
                          recommendation={job.latestMatch.recommendation}
                          score={job.latestMatch.score}
                        />
                      ) : (
                        <span className="text-xs text-zinc-500">not analysed</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No saved jobs yet.</p>
          )}

          {adding ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-3 text-base font-semibold">Add a job</h2>
              <AddJobForm
                onSaved={(id) => {
                  setAdding(false);
                  void refreshList();
                  void open(id);
                }}
              />
            </section>
          ) : (
            <Button className="self-start" onClick={() => setAdding(true)}>
              Add a job
            </Button>
          )}
        </>
      )}
    </div>
  );
}
