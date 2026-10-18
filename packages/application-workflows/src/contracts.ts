import type { ApplicationId, DocumentId, JobId, UserId } from '@job-agent/shared';

/**
 * Contracts for turning a matched job into an application.
 *
 * Rule: form values come only from the candidate's verified answers or verified profile
 * fields. When no verified value exists, the field is reported as unresolved - the system
 * never generates an answer to a factual question (salary, notice period, visa status, ...).
 */

export interface VerifiedAnswerUse {
  fieldKey: string;
  answerId: string;
  value: string;
}

export interface UnresolvedField {
  fieldKey: string;
  label: string;
  reason: 'no_verified_answer' | 'ambiguous_field' | 'unsupported_input';
}

export interface ApplicationPackage {
  applicationId: ApplicationId;
  cvDocumentId: DocumentId;
  coverLetterDocumentId: DocumentId | null;
  answers: VerifiedAnswerUse[];
  unresolvedFields: UnresolvedField[];
  /** Hash of everything above. Approvals are bound to this hash. */
  contentHash: string;
}

export interface ApplicationPreparer {
  prepare(userId: UserId, jobId: JobId, signal: AbortSignal): Promise<ApplicationPackage>;
}

/** A field detected on an application form by the browser agent or extension. */
export interface DetectedFormField {
  selector: string;
  label: string;
  inputType: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'date' | 'other';
  required: boolean;
  options?: string[];
}

export interface FieldMapping {
  selector: string;
  fieldKey: string;
  /** Present only when backed by a verified answer or a generated document. */
  value: string | { documentId: DocumentId } | null;
  confidence: 'high' | 'low';
}

export interface FormFieldMapper {
  map(fields: DetectedFormField[], pkg: ApplicationPackage): Promise<FieldMapping[]>;
}

export interface SubmissionEvidence {
  kind: 'confirmation_page' | 'confirmation_email' | 'portal_status' | 'user_confirmation';
  /** Reference to a stored screenshot/text in private storage, never inline personal data. */
  storageKey: string | null;
  capturedAt: Date;
  summary: string;
}

export interface VerificationOutcome {
  status: 'confirmed' | 'not_submitted' | 'uncertain';
  evidence: SubmissionEvidence[];
}

export interface SubmissionVerifier {
  verify(
    userId: UserId,
    applicationId: ApplicationId,
    signal: AbortSignal,
  ): Promise<VerificationOutcome>;
}

export type HandoffReason =
  | 'source_automation_not_permitted'
  | 'user_manual_mode'
  | 'blocker_requires_user'
  | 'unsupported_form';

/** Everything the user needs to finish an application themselves. */
export interface HandoffTicket {
  applicationId: ApplicationId;
  reason: HandoffReason;
  applyUrl: string;
  cvDocumentId: DocumentId;
  coverLetterDocumentId: DocumentId | null;
  answers: VerifiedAnswerUse[];
  unresolvedFields: UnresolvedField[];
}

export interface ManualHandoffService {
  create(
    userId: UserId,
    applicationId: ApplicationId,
    reason: HandoffReason,
  ): Promise<HandoffTicket>;
}
