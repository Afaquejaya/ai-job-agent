'use client';

import {
  EMPLOYMENT_TYPES,
  LANGUAGE_PROFICIENCIES,
  PROFILE_FIELDS,
  SKILL_LEVELS,
  TARGET_REGION_COUNTRIES,
  WORK_AUTHORIZATION_STATUSES,
  WORKPLACE_TYPES,
  type CandidateProfile,
  type CandidateProfileFields,
} from '@job-agent/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Alert, Button, Field, Select, TextArea, TextInput } from '@/components/ui/form';
import { ListEditor } from '@/components/ui/list-editor';
import { apiRequest, describeFailure, jsonInit } from '@/lib/api-client';

type Fields = CandidateProfileFields;
type Item<K extends keyof Fields> = NonNullable<Fields[K]> extends Array<infer T> ? T : never;

const COUNTRIES = [
  ...TARGET_REGION_COUNTRIES,
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'DE', name: 'Germany' },
];
const CURRENCIES = ['INR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'USD', 'EUR', 'GBP'];

/** '' in an input means "not provided" (null). */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value);
const numOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value));
const label = (value: string) => value.replace(/_/g, ' ');

function CountrySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a country</option>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

function TriState({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <Select
      value={value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}
    >
      <option value="">Not provided</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </Select>
  );
}

export function ProfileForm({ initial }: { initial: CandidateProfile }) {
  const [fields, setFields] = useState<Fields>(initial);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setStatus(null);
    const body = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, fields[f]]));
    const result = await apiRequest<{ profile: CandidateProfile }>(
      '/api/profile',
      jsonInit('PATCH', body),
    );
    setPending(false);
    if (result.ok) {
      setFields(result.data.profile);
      setStatus({ tone: 'success', message: 'Profile saved.' });
    } else {
      setStatus({ tone: 'error', message: describeFailure(result.error) });
    }
  }

  const prefs = fields.employmentPreferences;
  const setPrefs = (changes: Partial<NonNullable<Fields['employmentPreferences']>>) =>
    set('employmentPreferences', {
      employmentTypes: prefs?.employmentTypes ?? [],
      workplaceTypes: prefs?.workplaceTypes ?? [],
      willingToRelocate: prefs?.willingToRelocate ?? null,
      earliestStartDate: prefs?.earliestStartDate ?? null,
      ...changes,
    });
  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Card title="Contact">
        <Grid>
          <Field label="Full name">
            <TextInput
              value={fields.fullName ?? ''}
              onChange={(e) => set('fullName', orNull(e.target.value))}
            />
          </Field>
          <Field label="Preferred name">
            <TextInput
              value={fields.preferredName ?? ''}
              onChange={(e) => set('preferredName', orNull(e.target.value))}
            />
          </Field>
          <Field
            label="Contact email"
            hint="Used on applications; can differ from your login email."
          >
            <TextInput
              type="email"
              value={fields.email ?? ''}
              onChange={(e) => set('email', orNull(e.target.value))}
            />
          </Field>
          <Field label="Phone" hint="International format, e.g. +919876543210">
            <TextInput
              type="tel"
              value={fields.phone ?? ''}
              onChange={(e) => set('phone', orNull(e.target.value))}
            />
          </Field>
          <Field label="Current role">
            <TextInput
              value={fields.currentRole ?? ''}
              onChange={(e) => set('currentRole', orNull(e.target.value))}
            />
          </Field>
          <Field
            label="Total experience (months)"
            hint={
              fields.totalExperienceMonths
                ? `≈ ${(fields.totalExperienceMonths / 12).toFixed(1)} years`
                : undefined
            }
          >
            <TextInput
              type="number"
              min={0}
              max={720}
              value={fields.totalExperienceMonths ?? ''}
              onChange={(e) => set('totalExperienceMonths', numOrNull(e.target.value))}
            />
          </Field>
          <Field label="Current city">
            <TextInput
              value={fields.currentLocation?.city ?? ''}
              onChange={(e) =>
                set('currentLocation', {
                  city: orNull(e.target.value),
                  countryCode: fields.currentLocation?.countryCode ?? '',
                })
              }
            />
          </Field>
          <Field label="Current country">
            <CountrySelect
              value={fields.currentLocation?.countryCode ?? ''}
              onChange={(code) =>
                set(
                  'currentLocation',
                  code ? { city: fields.currentLocation?.city ?? null, countryCode: code } : null,
                )
              }
            />
          </Field>
        </Grid>
      </Card>

      <Card title="Professional summary">
        <TextArea
          rows={5}
          maxLength={3000}
          value={fields.professionalSummary ?? ''}
          onChange={(e) => set('professionalSummary', orNull(e.target.value))}
        />
      </Card>

      <Card title="Work experience">
        <ListEditor<Item<'workExperience'>>
          items={fields.workExperience}
          onChange={(items) => set('workExperience', items)}
          max={50}
          addLabel="Add a role"
          newItem={() => ({
            company: '',
            title: '',
            startDate: '',
            endDate: null,
            current: false,
            location: null,
            summary: null,
          })}
          renderItem={(job, update) => (
            <Grid>
              <Field label="Company">
                <TextInput
                  value={job.company}
                  onChange={(e) => update({ company: e.target.value })}
                />
              </Field>
              <Field label="Title">
                <TextInput value={job.title} onChange={(e) => update({ title: e.target.value })} />
              </Field>
              <Field label="Start">
                <TextInput
                  type="month"
                  value={job.startDate}
                  onChange={(e) => update({ startDate: e.target.value })}
                />
              </Field>
              <Field label="End">
                <TextInput
                  type="month"
                  disabled={job.current}
                  value={job.endDate ?? ''}
                  onChange={(e) => update({ endDate: orNull(e.target.value) })}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={job.current}
                  onChange={(e) =>
                    update({
                      current: e.target.checked,
                      endDate: e.target.checked ? null : job.endDate,
                    })
                  }
                />
                I currently work here
              </label>
              <Field label="Location">
                <TextInput
                  value={job.location ?? ''}
                  onChange={(e) => update({ location: orNull(e.target.value) })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Summary">
                  <TextArea
                    rows={3}
                    value={job.summary ?? ''}
                    onChange={(e) => update({ summary: orNull(e.target.value) })}
                  />
                </Field>
              </div>
            </Grid>
          )}
        />
      </Card>

      <Card title="Education">
        <ListEditor<Item<'education'>>
          items={fields.education}
          onChange={(items) => set('education', items)}
          max={20}
          addLabel="Add education"
          newItem={() => ({
            institution: '',
            degree: null,
            fieldOfStudy: null,
            startDate: null,
            endDate: null,
            grade: null,
          })}
          renderItem={(edu, update) => (
            <Grid>
              <Field label="Institution">
                <TextInput
                  value={edu.institution}
                  onChange={(e) => update({ institution: e.target.value })}
                />
              </Field>
              <Field label="Degree">
                <TextInput
                  value={edu.degree ?? ''}
                  onChange={(e) => update({ degree: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Field of study">
                <TextInput
                  value={edu.fieldOfStudy ?? ''}
                  onChange={(e) => update({ fieldOfStudy: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Grade">
                <TextInput
                  value={edu.grade ?? ''}
                  onChange={(e) => update({ grade: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Start">
                <TextInput
                  type="month"
                  value={edu.startDate ?? ''}
                  onChange={(e) => update({ startDate: orNull(e.target.value) })}
                />
              </Field>
              <Field label="End">
                <TextInput
                  type="month"
                  value={edu.endDate ?? ''}
                  onChange={(e) => update({ endDate: orNull(e.target.value) })}
                />
              </Field>
            </Grid>
          )}
        />
      </Card>

      <Card title="Skills">
        <ListEditor<Item<'skills'>>
          items={fields.skills}
          onChange={(items) => set('skills', items)}
          max={100}
          addLabel="Add a skill"
          newItem={() => ({ name: '', level: null, years: null })}
          renderItem={(skill, update) => (
            <Grid>
              <Field label="Skill">
                <TextInput value={skill.name} onChange={(e) => update({ name: e.target.value })} />
              </Field>
              <Field label="Level">
                <Select
                  value={skill.level ?? ''}
                  onChange={(e) => update({ level: orNull(e.target.value) as typeof skill.level })}
                >
                  <option value="">Not provided</option>
                  {SKILL_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {label(l)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Years">
                <TextInput
                  type="number"
                  min={0}
                  max={60}
                  value={skill.years ?? ''}
                  onChange={(e) => update({ years: numOrNull(e.target.value) })}
                />
              </Field>
            </Grid>
          )}
        />
      </Card>

      <Card title="Certifications">
        <ListEditor<Item<'certifications'>>
          items={fields.certifications}
          onChange={(items) => set('certifications', items)}
          max={50}
          addLabel="Add a certification"
          newItem={() => ({
            name: '',
            issuer: null,
            issuedOn: null,
            expiresOn: null,
            credentialId: null,
          })}
          renderItem={(cert, update) => (
            <Grid>
              <Field label="Name">
                <TextInput value={cert.name} onChange={(e) => update({ name: e.target.value })} />
              </Field>
              <Field label="Issuer">
                <TextInput
                  value={cert.issuer ?? ''}
                  onChange={(e) => update({ issuer: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Issued">
                <TextInput
                  type="month"
                  value={cert.issuedOn ?? ''}
                  onChange={(e) => update({ issuedOn: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Expires">
                <TextInput
                  type="month"
                  value={cert.expiresOn ?? ''}
                  onChange={(e) => update({ expiresOn: orNull(e.target.value) })}
                />
              </Field>
            </Grid>
          )}
        />
      </Card>

      <Card title="Languages">
        <ListEditor<Item<'languages'>>
          items={fields.languages}
          onChange={(items) => set('languages', items)}
          max={20}
          addLabel="Add a language"
          newItem={() => ({ language: '', proficiency: 'professional' })}
          renderItem={(lang, update) => (
            <Grid>
              <Field label="Language">
                <TextInput
                  value={lang.language}
                  onChange={(e) => update({ language: e.target.value })}
                />
              </Field>
              <Field label="Proficiency">
                <Select
                  value={lang.proficiency}
                  onChange={(e) =>
                    update({ proficiency: e.target.value as typeof lang.proficiency })
                  }
                >
                  {LANGUAGE_PROFICIENCIES.map((p) => (
                    <option key={p} value={p}>
                      {label(p)}
                    </option>
                  ))}
                </Select>
              </Field>
            </Grid>
          )}
        />
      </Card>

      <Card title="Work authorization">
        <ListEditor<Item<'workAuthorization'>>
          items={fields.workAuthorization}
          onChange={(items) => set('workAuthorization', items)}
          max={30}
          addLabel="Add a country"
          newItem={() => ({ countryCode: '', status: 'unknown', validUntil: null })}
          renderItem={(auth, update) => (
            <Grid>
              <Field label="Country">
                <CountrySelect
                  value={auth.countryCode}
                  onChange={(code) => update({ countryCode: code })}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={auth.status}
                  onChange={(e) => update({ status: e.target.value as typeof auth.status })}
                >
                  {WORK_AUTHORIZATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Valid until">
                <TextInput
                  type="date"
                  value={auth.validUntil ?? ''}
                  onChange={(e) => update({ validUntil: orNull(e.target.value) })}
                />
              </Field>
            </Grid>
          )}
        />
      </Card>

      <Card title="Preferred locations">
        <ListEditor<Item<'preferredLocations'>>
          items={fields.preferredLocations}
          onChange={(items) => set('preferredLocations', items)}
          max={20}
          addLabel="Add a location"
          newItem={() => ({ city: null, countryCode: '', remoteOk: null })}
          renderItem={(loc, update) => (
            <Grid>
              <Field label="City">
                <TextInput
                  value={loc.city ?? ''}
                  onChange={(e) => update({ city: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Country">
                <CountrySelect
                  value={loc.countryCode}
                  onChange={(code) => update({ countryCode: code })}
                />
              </Field>
              <Field label="Remote OK">
                <TriState value={loc.remoteOk} onChange={(v) => update({ remoteOk: v })} />
              </Field>
            </Grid>
          )}
        />
      </Card>

      <Card title="Notice period and salary">
        <Grid>
          <Field label="Notice period (days)">
            <TextInput
              type="number"
              min={0}
              max={365}
              value={fields.noticePeriod?.days ?? ''}
              onChange={(e) => {
                const days = numOrNull(e.target.value);
                const negotiable = fields.noticePeriod?.negotiable ?? null;
                set(
                  'noticePeriod',
                  days === null && negotiable === null ? null : { days, negotiable },
                );
              }}
            />
          </Field>
          <Field label="Notice negotiable">
            <TriState
              value={fields.noticePeriod?.negotiable ?? null}
              onChange={(negotiable) => {
                const days = fields.noticePeriod?.days ?? null;
                set(
                  'noticePeriod',
                  days === null && negotiable === null ? null : { days, negotiable },
                );
              }}
            />
          </Field>
          <Field label="Expected salary (per year)">
            <TextInput
              type="number"
              min={0}
              step="0.01"
              value={fields.expectedSalary ?? ''}
              onChange={(e) => set('expectedSalary', numOrNull(e.target.value))}
            />
          </Field>
          <Field label="Currency">
            <Select
              value={fields.salaryCurrency ?? ''}
              onChange={(e) => set('salaryCurrency', orNull(e.target.value))}
            >
              <option value="">Not provided</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </Grid>
      </Card>

      <Card title="Employment preferences">
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1 w-full text-sm font-medium">Employment types</legend>
            {EMPLOYMENT_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs?.employmentTypes.includes(type) ?? false}
                  onChange={() =>
                    setPrefs({ employmentTypes: toggle(prefs?.employmentTypes ?? [], type) })
                  }
                />
                {label(type)}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1 w-full text-sm font-medium">Workplace</legend>
            {WORKPLACE_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs?.workplaceTypes.includes(type) ?? false}
                  onChange={() =>
                    setPrefs({ workplaceTypes: toggle(prefs?.workplaceTypes ?? [], type) })
                  }
                />
                {label(type)}
              </label>
            ))}
          </fieldset>
          <Grid>
            <Field label="Willing to relocate">
              <TriState
                value={prefs?.willingToRelocate ?? null}
                onChange={(v) => setPrefs({ willingToRelocate: v })}
              />
            </Field>
            <Field label="Earliest start date">
              <TextInput
                type="date"
                value={prefs?.earliestStartDate ?? ''}
                onChange={(e) => setPrefs({ earliestStartDate: orNull(e.target.value) })}
              />
            </Field>
          </Grid>
        </div>
      </Card>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-zinc-200 bg-zinc-50/95 py-3 dark:border-zinc-800 dark:bg-zinc-950/95">
        {status ? <Alert tone={status.tone}>{status.message}</Alert> : null}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
