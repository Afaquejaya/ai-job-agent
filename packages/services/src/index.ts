import type { Database } from '@job-agent/database';
import type { DataCipher } from '@job-agent/security';
import type { ObjectStorage } from '@job-agent/storage';
import { createAiRuntime, type AiSettings } from './ai';
import { createJobSearchService, type JobSearchSettings } from './job-search';
import { createMatchingService } from './matching';
import { createResumeService } from './resumes';

export * from './ai';
export * from './env';
export * from './job-search';
export * from './matching';
export * from './resumes';
export * from './tasks';

/** The use cases shared by the web app and the worker, wired to their dependencies. */
export function createServices(deps: {
  db: Database;
  cipher: DataCipher;
  storage: ObjectStorage;
  ai: AiSettings;
  jobSearch?: JobSearchSettings;
}) {
  const ai = createAiRuntime(deps.ai, deps.db);
  const resumes = createResumeService(deps);
  const matching = createMatchingService({ db: deps.db, cipher: deps.cipher, ai, resumes });
  const jobSearch = createJobSearchService({
    db: deps.db,
    resumes,
    settings: deps.jobSearch ?? {},
  });
  return { ai, resumes, matching, jobSearch };
}

export type Services = ReturnType<typeof createServices>;
