import { aiSettingsFromEnv, createServices, type Services } from '@job-agent/services';
import { getDatabase } from './db';
import { getWebEnv, type WebEnv } from './env';
import { getCipher, getStorage } from './storage';

// One set per server process, rebuilt when the environment is re-read (tests).
const globalForServices = globalThis as unknown as {
  jobAgentServices?: { env: WebEnv; services: Services };
};

export function getServices(): Services {
  const env = getWebEnv();
  if (globalForServices.jobAgentServices?.env !== env) {
    globalForServices.jobAgentServices = {
      env,
      services: createServices({
        db: getDatabase(),
        cipher: getCipher(),
        storage: getStorage(),
        ai: aiSettingsFromEnv(env),
      }),
    };
  }
  return globalForServices.jobAgentServices.services;
}
