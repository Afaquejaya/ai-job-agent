'use client';

import {
  RESUME_LIMITS,
  type ExtractionStatus,
  type ResumeDetail,
  type ResumeSuggestion,
  type ResumeSummary,
} from '@job-agent/shared';
import { useCallback, useState, type DragEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Alert, Badge, Button } from '@/components/ui/form';
import { apiRequest, describeFailure, jsonInit } from '@/lib/api-client';

const ACCEPT =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const STATUS_BADGE: Record<
  ExtractionStatus,
  { tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; text: string }
> = {
  UPLOADED: { tone: 'neutral', text: 'Uploaded' },
  PROCESSING: { tone: 'info', text: 'Processing' },
  EXTRACTED: { tone: 'success', text: 'Text extracted' },
  NEEDS_REVIEW: { tone: 'warning', text: 'Needs review' },
  FAILED: { tone: 'danger', text: 'Failed' },
};

const SUGGESTION_LABEL: Record<string, string> = {
  'profile:email': 'Contact email (profile)',
  'profile:phone': 'Phone (profile)',
  'answer:linkedin_url': 'LinkedIn URL (reusable answer, saved as draft)',
};

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Suggestions({
  resume,
  onApplied,
}: {
  resume: ResumeDetail;
  onApplied: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const differs = (s: ResumeSuggestion) => s.currentValue !== s.value;

  async function apply() {
    setPending(true);
    setError(null);
    const result = await apiRequest<{ applied: { profileFields: string[]; answers: string[] } }>(
      `/api/resumes/${resume.id}/suggestions/apply`,
      jsonInit('POST', { suggestionIds: selected }),
    );
    setPending(false);
    if (!result.ok) return setError(describeFailure(result.error));
    setSelected([]);
    onApplied('Selected suggestions applied.');
  }

  if (resume.suggestions.length === 0) {
    return <p className="text-sm text-zinc-500">No contact details were found in this CV.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Found by pattern matching in the CV text. Nothing is saved until you select and apply it.
      </p>
      {resume.suggestions.map((s) => (
        <label
          key={s.id}
          className="flex gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
        >
          <input
            type="checkbox"
            disabled={!differs(s)}
            checked={selected.includes(s.id)}
            onChange={() =>
              setSelected((cur) =>
                cur.includes(s.id) ? cur.filter((id) => id !== s.id) : [...cur, s.id],
              )
            }
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-medium">{SUGGESTION_LABEL[s.id] ?? s.id}</span>
            <span className="break-all">
              Suggested: <strong>{s.value}</strong>
            </span>
            <span className="break-all text-zinc-500">
              Currently: {s.currentValue ?? 'not provided'}
              {!differs(s) ? ' (already the same)' : ''}
            </span>
            <span className="break-all text-xs text-zinc-500">
              Found in CV as: &ldquo;{s.evidence}&rdquo;
            </span>
          </span>
        </label>
      ))}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button className="self-start" disabled={pending || selected.length === 0} onClick={apply}>
        {pending ? 'Applying…' : `Apply selected (${selected.length})`}
      </Button>
    </div>
  );
}

export function ResumesClient({ initial }: { initial: ResumeSummary[] }) {
  const [resumes, setResumes] = useState(initial);
  const [detail, setDetail] = useState<ResumeDetail | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const refresh = useCallback(async (selectId?: string) => {
    const list = await apiRequest<{ resumes: ResumeSummary[] }>('/api/resumes');
    if (list.ok) setResumes(list.data.resumes);
    if (selectId) {
      const one = await apiRequest<{ resume: ResumeDetail }>(`/api/resumes/${selectId}`);
      setDetail(one.ok ? one.data.resume : null);
    }
  }, []);

  async function upload(file: File) {
    setMessage(null);
    if (file.size > RESUME_LIMITS.maxFileBytes) {
      return setMessage({ tone: 'error', text: 'The file is larger than 10 MB.' });
    }
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    const result = await apiRequest<{ resume: ResumeDetail }>('/api/resumes', {
      method: 'POST',
      body: form,
    });
    setBusy(false);
    if (!result.ok) {
      const existing = (result.error.details as { existingVersion?: number } | null)
        ?.existingVersion;
      return setMessage({
        tone: 'error',
        text: existing
          ? `${result.error.message} (version ${existing})`
          : describeFailure(result.error),
      });
    }
    const resume = result.data.resume;
    setDetail(resume);
    setMessage({
      tone: resume.extractionStatus === 'EXTRACTED' ? 'success' : 'error',
      text:
        resume.extractionStatus === 'EXTRACTED'
          ? `Uploaded as version ${resume.version}. Text extracted.`
          : `Uploaded as version ${resume.version}. ${resume.extractionError ?? ''}`,
    });
    await refresh();
  }

  async function act(path: string, method: string, success: string, selectId?: string) {
    setBusy(true);
    setMessage(null);
    const result = await apiRequest<unknown>(path, { method });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: 'error', text: describeFailure(result.error) });
    setMessage({ tone: 'success', text: success });
    await refresh(selectId);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center text-sm ${
          dragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
            : 'border-zinc-300 dark:border-zinc-700'
        }`}
      >
        <p>Drag a CV here, or choose a file. PDF or Word (.docx), up to 10 MB.</p>
        <label className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
          {busy ? 'Working…' : 'Choose file'}
          <input
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
      </div>

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      <Card title="Versions">
        {resumes.length === 0 ? (
          <p>No CV uploaded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {resumes.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    v{r.version} · {r.originalFilename}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={STATUS_BADGE[r.extractionStatus].tone}>
                      {STATUS_BADGE[r.extractionStatus].text}
                    </Badge>
                    {r.isPrimary ? <Badge tone="info">Primary</Badge> : null}
                    <span>{formatSize(r.fileSizeBytes)}</span>
                    <span>{new Date(r.createdAt).toLocaleString()}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => refresh(r.id)}>
                    Review
                  </Button>
                  <a
                    className="inline-flex items-center rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    href={`/api/resumes/${r.id}/file`}
                  >
                    Download
                  </a>
                  {!r.isPrimary ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/api/resumes/${r.id}/primary`,
                          'POST',
                          `Version ${r.version} is now primary.`,
                        )
                      }
                    >
                      Make primary
                    </Button>
                  ) : null}
                  {r.extractionStatus === 'FAILED' || r.extractionStatus === 'NEEDS_REVIEW' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        act(`/api/resumes/${r.id}/reprocess`, 'POST', 'Processed again.', r.id)
                      }
                    >
                      Retry
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete version ${r.version} (${r.originalFilename})? This removes the file.`,
                        )
                      ) {
                        if (detail?.id === r.id) setDetail(null);
                        void act(`/api/resumes/${r.id}`, 'DELETE', `Version ${r.version} deleted.`);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail ? (
        <Card title={`Review: version ${detail.version}`}>
          <div className="flex flex-col gap-4">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_BADGE[detail.extractionStatus].tone}>
                {STATUS_BADGE[detail.extractionStatus].text}
              </Badge>
              {detail.pageCount !== null ? <span>{detail.pageCount} page(s)</span> : null}
              {detail.textCharCount !== null ? (
                <span>{detail.textCharCount.toLocaleString()} characters</span>
              ) : null}
            </p>
            {detail.extractionError ? <Alert tone="error">{detail.extractionError}</Alert> : null}
            <Suggestions
              resume={detail}
              onApplied={(text) => {
                setMessage({ tone: 'success', text });
                void refresh(detail.id);
              }}
            />
            {detail.textPreview ? (
              <details>
                <summary className="cursor-pointer font-medium">Extracted text</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
                  {detail.textPreview}
                  {detail.textTruncated ? '\n…' : ''}
                </pre>
              </details>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
