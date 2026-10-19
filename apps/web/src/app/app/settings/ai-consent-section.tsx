'use client';

import { useState } from 'react';
import { AiConsent } from '@/components/ai/ai-consent';

export function AiConsentSection({
  initialConsent,
  runsLocally,
}: {
  initialConsent: boolean;
  runsLocally: boolean;
}) {
  const [consentGiven, setConsentGiven] = useState(initialConsent);
  return (
    <AiConsent
      compact
      consentGiven={consentGiven}
      runsLocally={runsLocally}
      onChange={setConsentGiven}
    />
  );
}
