import { SKILL_TERMS } from './relevance';

/**
 * What to search for, worked out from the CV and profile without AI (D-049). The user sees
 * and can edit it before a search starts.
 */
export interface SearchPlan {
  keywords: string[];
  countries: string[];
  remoteOk: boolean;
  /** The CV's most mentioned known skills, used to explain the plan. */
  topSkills: string[];
}

export interface SearchPlanProfile {
  currentRole: string | null;
  currentLocation: { countryCode: string } | null;
  preferredLocations: Array<{ countryCode: string; remoteOk: boolean | null }> | null;
}

const ROLE_WORD =
  /\b(developer|engineer|architect|programmer|lead|manager|designer|analyst|consultant|specialist|scientist|administrator)\b/i;

/** Known skills ordered by how often the CV mentions them. */
export function topSkills(cvText: string, limit = 5): string[] {
  return SKILL_TERMS.map((term) => ({
    name: term.name,
    count: (cvText.match(new RegExp(term.pattern.source, 'gi')) ?? []).length,
  }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((s) => s.name);
}

/** A role title such as "Senior Flutter Developer" from a CV headline line. */
function cleanRole(line: string): string | null {
  const first = line.split(/[|•·,–—]| - /)[0]!.trim();
  if (first.length < 5 || first.length > 60 || !ROLE_WORD.test(first)) return null;
  if (/@|\d{4}|https?:/.test(first)) return null;
  return first.replace(/\s+/g, ' ');
}

export function suggestSearchPlan(cvText: string, profile: SearchPlanProfile): SearchPlan {
  const keywords: string[] = [];
  const add = (value: string | null) => {
    if (value && !keywords.some((k) => k.toLowerCase() === value.toLowerCase())) {
      keywords.push(value);
    }
  };

  add(profile.currentRole ? (cleanRole(profile.currentRole) ?? profile.currentRole.trim()) : null);
  for (const line of cvText.split(/\r?\n/).slice(0, 8)) add(cleanRole(line.trim()));
  const skills = topSkills(cvText);
  // The main skill as a role, unless a role already names it (saves search quota).
  const main = skills[0];
  if (main && !keywords.some((k) => k.toLowerCase().includes(main.toLowerCase()))) {
    add(`${main} developer`);
  }

  const countries = [
    ...(profile.preferredLocations ?? []).map((l) => l.countryCode.toUpperCase()),
    ...(profile.currentLocation ? [profile.currentLocation.countryCode.toUpperCase()] : []),
  ].filter((code, index, all) => all.indexOf(code) === index);
  const remoteSetting = profile.preferredLocations?.find((l) => l.remoteOk !== null)?.remoteOk;

  return {
    keywords: keywords.slice(0, 3),
    countries: countries.length > 0 ? countries.slice(0, 7) : ['IN'],
    remoteOk: remoteSetting ?? true,
    topSkills: skills,
  };
}
