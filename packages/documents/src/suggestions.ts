import type { SuggestionTarget } from '@job-agent/shared';

/**
 * Deterministic contact suggestions (Phase 2B decision 3b: no AI). Each suggestion keeps the
 * exact text it was found in as `evidence`. A value is only suggested when it is fully present
 * in the CV: for example, phone numbers are suggested only when written in international `+`
 * format, because guessing a country code would be inventing data.
 */
export interface SuggestionDraft {
  target: SuggestionTarget;
  value: string;
  evidence: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE = /\+\d[\d ().-]{6,20}\d/;
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_-]{3,100}\/?/i;

export function findContactSuggestions(text: string): SuggestionDraft[] {
  const suggestions: SuggestionDraft[] = [];

  const email = EMAIL.exec(text);
  if (email) {
    suggestions.push({
      target: { kind: 'profile', field: 'email' },
      value: email[0].toLowerCase(),
      evidence: email[0],
    });
  }

  const phone = PHONE.exec(text);
  if (phone) {
    const digits = phone[0].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) {
      suggestions.push({
        target: { kind: 'profile', field: 'phone' },
        value: `+${digits}`,
        evidence: phone[0],
      });
    }
  }

  const linkedin = LINKEDIN.exec(text);
  if (linkedin) {
    const path = linkedin[0].replace(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?/i, '').replace(/\/$/, '');
    suggestions.push({
      target: { kind: 'answer', questionKey: 'linkedin_url' },
      value: `https://www.${path.toLowerCase()}`,
      evidence: linkedin[0],
    });
  }

  // Guarantee the evidence contract: never emit a suggestion whose quote is not in the text.
  return suggestions.filter((s) => text.includes(s.evidence));
}
