import { z } from 'zod';

/**
 * Nominal ("branded") string types. They are plain strings at runtime, but the compiler
 * refuses to pass a JobId where a UserId is expected. All identifiers are UUIDs.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type JobId = Brand<string, 'JobId'>;
export type ApplicationId = Brand<string, 'ApplicationId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type BrowserAgentId = Brand<string, 'BrowserAgentId'>;

export const uuidSchema = z.uuid();
