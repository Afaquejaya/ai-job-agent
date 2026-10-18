import type { MatchAnalysis, MatchAssessment, MatchRecommendation } from '@job-agent/shared';
import { Badge } from '@/components/ui/form';

export const RECOMMENDATION_LABELS: Record<
  MatchRecommendation,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }
> = {
  strong: { label: 'Strong match', tone: 'success' },
  possible: { label: 'Possible match', tone: 'info' },
  weak: { label: 'Weak match', tone: 'warning' },
  ineligible: { label: 'Missing a mandatory requirement', tone: 'danger' },
  insufficient_information: { label: 'Not enough information', tone: 'neutral' },
};

const ASSESSMENT_TONES: Record<MatchAssessment, 'success' | 'info' | 'danger' | 'neutral'> = {
  meets: 'success',
  partial: 'info',
  missing: 'danger',
  unknown: 'neutral',
};

const FACTOR_LABELS: Record<string, string> = {
  skills: 'Skills',
  experience: 'Experience',
  seniority: 'Seniority',
  education: 'Education',
  location: 'Location',
  work_authorization: 'Work authorization',
  salary: 'Salary',
  language: 'Language',
};

export function RecommendationBadge({
  recommendation,
  score,
}: {
  recommendation: MatchRecommendation;
  score: number | null;
}) {
  const { label, tone } = RECOMMENDATION_LABELS[recommendation];
  return <Badge tone={tone}>{score === null ? label : `${score}/100 · ${label}`}</Badge>;
}

function Quote({ label, text }: { label: string; text: string | null }) {
  if (!text) return <p className="text-xs text-zinc-500">{label}: not mentioned</p>;
  return (
    <p className="text-xs">
      <span className="text-zinc-500">{label}: </span>
      <q className="text-zinc-800 italic dark:text-zinc-200">{text}</q>
    </p>
  );
}

/** The evidence-based match result. The score is computed by the server, not the model. */
export function MatchCard({ match }: { match: MatchAnalysis }) {
  return (
    <section
      aria-label="Match analysis"
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold tabular-nums">
          {match.score === null ? '–' : match.score}
          <span className="text-base font-normal text-zinc-500">/100</span>
        </span>
        <RecommendationBadge recommendation={match.recommendation} score={null} />
      </header>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{match.summary}</p>

      {match.gaps.length > 0 ? (
        <div className="text-sm">
          <h3 className="font-medium">Main gaps</h3>
          <ul className="mt-1 list-disc pl-5 text-zinc-700 dark:text-zinc-300">
            {match.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {match.factors.map((factor) => (
          <div key={factor.factor} className="flex flex-col gap-1 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{FACTOR_LABELS[factor.factor] ?? factor.factor}</span>
              <Badge tone={ASSESSMENT_TONES[factor.assessment]}>{factor.assessment}</Badge>
              {factor.mandatory ? <Badge tone="warning">mandatory</Badge> : null}
              <span className="text-xs text-zinc-500">weight {factor.weight}</span>
            </div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{factor.explanation}</p>
            {factor.jobEvidence || factor.cvEvidence ? (
              <>
                <Quote label="Job says" text={factor.jobEvidence} />
                <Quote label="Your CV/profile says" text={factor.cvEvidence} />
              </>
            ) : null}
            {factor.note ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">Checked: {factor.note}</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-500">
        Analysed {new Date(match.createdAt).toLocaleString()} with {match.model}
        {match.resumeVersion ? ` against CV version ${match.resumeVersion}` : ''}. Quotes are
        checked word for word against the job and your CV; unverified claims count as unknown.
      </p>
    </section>
  );
}
