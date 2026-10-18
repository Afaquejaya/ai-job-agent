'use client';

import { useState } from 'react';
import { AiConsent } from '@/components/ai/ai-consent';

export function AiConsentSection({ initialConsent }: { initialConsent: boolean }) {
  const [consentGiven, setConsentGiven] = useState(initialConsent);
  return <AiConsent compact consentGiven={consentGiven} onChange={setConsentGiven} />;
}
