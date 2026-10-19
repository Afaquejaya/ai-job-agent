import type { Database } from '@job-agent/database';
import type { DataCipher } from '@job-agent/security';
import type { ObjectStorage } from '@job-agent/storage';
import { createAiRuntime, type AiSettings } from './ai';
import { createMatchingService } from './matching';
import { createResumeService } from './resumes';

export * from './ai';
export * from './env';
export * from './matching';
export * from './resumes';
export * from './tasks';

/** The use cases shared by the web app and the worker, wired to their dependencies. */
export function createServices(deps: {
  db: Database;
  cipher: DataCipher;
  storage: ObjectStorage;
  ai: AiSettings;
}) {
  const ai = createAiRuntime(deps.ai, deps.db);
  const resumes = createResumeService(deps);
  const matching = createMatchingService({ db: deps.db, cipher: deps.cipher, ai, resumes });
  return { ai, resumes, matching };
}

export type Services = ReturnType<typeof createServices>;
