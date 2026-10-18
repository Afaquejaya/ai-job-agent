'use client';

import { useState } from 'react';
import { Alert, Button } from '@/components/ui/form';
import { apiErrorMessage } from '@/components/ui/api-error';

/**
 * Opt-in for AI processing. Until the user allows it, no CV, profile or job text is sent to
 * the AI provider (the server refuses with 403 consent_required).
 */
export function AiConsent({
  consentGiven,
  onChange,
  compact = false,
}: {
  consentGiven: boolean;
  onChange: (consentGiven: boolean) => void;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(consent: boolean) {
    setPending(true);
    setError(null);
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aiProcessingConsent: consent }),
    });
    setPending(false);
    if (response.ok) {
      onChange(consent);
      return;
    }
    setError(
      apiErrorMessage(await response.json().catch(() => null), 'Could not save your choice.'),
    );
  }

  return (
    <div
      className={`flex flex-col gap-3 text-sm ${compact ? '' : 'rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40'}`}
    >
      <p className="text-zinc-700 dark:text-zinc-300">
        {consentGiven ? (
          <>
            <strong>AI processing is allowed.</strong> Your CV text, profile, verified answers and
            the jobs you paste are sent to the AI provider (Anthropic) when you use the agent or run
            a match analysis.
          </>
        ) : (
          <>
            <strong>Allow AI processing to use the agent.</strong> When you allow it, your CV text,
            profile, verified answers and the jobs you paste are sent to the AI provider (Anthropic)
            to answer your requests. Nothing is sent before you allow it, and you can withdraw at
            any time.
          </>
        )}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant={consentGiven ? 'secondary' : 'primary'}
        size={compact ? 'sm' : 'md'}
        disabled={pending}
        className="self-start"
        onClick={() => void update(!consentGiven)}
      >
        {pending ? 'Saving…' : consentGiven ? 'Withdraw AI consent' : 'Allow AI processing'}
      </Button>
    </div>
  );
}
