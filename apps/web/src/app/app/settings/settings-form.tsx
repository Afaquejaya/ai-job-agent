'use client';

import {
  apiErrorSchema,
  MAX_DAILY_APPLICATION_LIMIT,
  TARGET_REGION_COUNTRIES,
  userSettingsSchema,
  type SubmissionMode,
  type UserSettings,
} from '@job-agent/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Field, fieldClass, TextInput } from '@/components/ui/form';

const MODES: Array<{ value: SubmissionMode; title: string; description: string }> = [
  {
    value: 'manual_only',
    title: 'Manual only (safest)',
    description: 'The agent prepares everything; you always submit applications yourself.',
  },
  {
    value: 'approve_each',
    title: 'Approve each',
    description:
      'On sources that permit automation, the agent may submit after you approve each application.',
  },
  {
    value: 'auto_where_permitted',
    title: 'Automatic where permitted',
    description:
      'On sources that explicitly permit automation, the agent may submit without asking. Everywhere else you still get a manual handoff.',
  },
];

export function SettingsForm({ initial }: { initial: UserSettings }) {
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const timeZones = useMemo(() => {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes(settings.timeZone) ? zones : [settings.timeZone, ...zones];
  }, [settings.timeZone]);
  const browserTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  function toggleCountry(code: string) {
    setSettings((current) => ({
      ...current,
      targetCountries: current.targetCountries.includes(code)
        ? current.targetCountries.filter((c) => c !== code)
        : [...current.targetCountries, code],
    }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setStatus(null);
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        timeZone: settings.timeZone,
        submissionMode: settings.submissionMode,
        dailyApplicationLimit: settings.dailyApplicationLimit,
        targetCountries: settings.targetCountries,
      }),
    });
    setPending(false);
    const body: unknown = await response.json().catch(() => null);

    if (response.ok) {
      const parsed = userSettingsSchema.safeParse(
        (body as { settings?: unknown } | null)?.settings,
      );
      if (parsed.success) setSettings(parsed.data);
      setStatus({ tone: 'success', message: 'Settings saved.' });
      return;
    }
    const error = apiErrorSchema.safeParse(body);
    const issues =
      error.success && Array.isArray(error.data.error.details) ? error.data.error.details : [];
    const detail = issues
      .map(
        (issue: { path?: string; message?: string }) =>
          `${issue.path || 'request'}: ${issue.message}`,
      )
      .join('; ');
    setStatus({
      tone: 'error',
      message: detail || (error.success ? error.data.error.message : 'Could not save settings.'),
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Field label="Time zone" hint="Daily limits and the morning report follow this time zone.">
        <select
          className={fieldClass}
          value={settings.timeZone}
          onChange={(e) => setSettings({ ...settings, timeZone: e.target.value })}
        >
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </Field>
      {browserTimeZone && browserTimeZone !== settings.timeZone ? (
        <button
          type="button"
          className="-mt-4 self-start text-xs text-blue-600 underline dark:text-blue-400"
          onClick={() => setSettings({ ...settings, timeZone: browserTimeZone })}
        >
          Use this device’s time zone ({browserTimeZone})
        </button>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Submission mode</legend>
        {MODES.map((mode) => (
          <label
            key={mode.value}
            className="flex gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
          >
            <input
              type="radio"
              name="submissionMode"
              value={mode.value}
              checked={settings.submissionMode === mode.value}
              onChange={() => setSettings({ ...settings, submissionMode: mode.value })}
            />
            <span>
              <span className="font-medium">{mode.title}</span>
              <span className="block text-zinc-600 dark:text-zinc-400">{mode.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Field
        label="Daily application limit"
        hint={`A ceiling, not a quota. 0 pauses submissions; maximum ${MAX_DAILY_APPLICATION_LIMIT}.`}
      >
        <TextInput
          type="number"
          min={0}
          max={MAX_DAILY_APPLICATION_LIMIT}
          step={1}
          value={settings.dailyApplicationLimit}
          onChange={(e) =>
            setSettings({ ...settings, dailyApplicationLimit: Number(e.target.value) })
          }
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Target countries</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TARGET_REGION_COUNTRIES.map((country) => (
            <label key={country.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.targetCountries.includes(country.code)}
                onChange={() => toggleCountry(country.code)}
              />
              {country.name}
            </label>
          ))}
        </div>
      </fieldset>

      {status ? <Alert tone={status.tone}>{status.message}</Alert> : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  );
}
