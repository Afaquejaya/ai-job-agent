import type { SourceDeclaration, SourceId } from './declaration';

const GCC = ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'];

const NOT_REVIEWED = (notes: string): SourceDeclaration['policyReview'] => ({
  status: 'not_reviewed',
  reviewedAt: null,
  notes,
});

/**
 * Initial source registry. Every entry is deny-by-default: no automation is permitted and
 * discovery is limited to user-provided links until each source's terms are reviewed and the
 * declaration is updated in a code-reviewed change (see docs/architecture/job-source-connectors.md).
 */
export const SOURCE_REGISTRY: Readonly<Record<SourceId, SourceDeclaration>> = {
  indeed: {
    sourceId: 'indeed',
    displayName: 'Indeed',
    countries: ['IN', ...GCC],
    implementationStatus: 'planned',
    discovery: ['manual_link'],
    applyMethods: ['external_redirect', 'on_platform_form'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: true,
    rateLimit: null,
    policyReview: NOT_REVIEWED('Review terms of service and any official partner/API programme.'),
  },
  linkedin: {
    sourceId: 'linkedin',
    displayName: 'LinkedIn',
    countries: ['IN', ...GCC],
    implementationStatus: 'planned',
    discovery: ['manual_link'],
    applyMethods: ['external_redirect', 'on_platform_form'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: true,
    rateLimit: null,
    policyReview: NOT_REVIEWED(
      'User agreement is expected to restrict automated access; plan for manual handoff only.',
    ),
  },
  naukri: {
    sourceId: 'naukri',
    displayName: 'Naukri.com',
    countries: ['IN'],
    implementationStatus: 'planned',
    discovery: ['manual_link'],
    applyMethods: ['external_redirect', 'on_platform_form'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: true,
    rateLimit: null,
    policyReview: NOT_REVIEWED('Review terms of use and any recruiter/partner API.'),
  },
  naukri_gulf: {
    sourceId: 'naukri_gulf',
    displayName: 'Naukri Gulf',
    countries: GCC,
    implementationStatus: 'planned',
    discovery: ['manual_link'],
    applyMethods: ['external_redirect', 'on_platform_form'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: true,
    rateLimit: null,
    policyReview: NOT_REVIEWED('Review terms of use.'),
  },
  company_career_page: {
    sourceId: 'company_career_page',
    displayName: 'Company career pages',
    countries: ['IN', ...GCC],
    implementationStatus: 'planned',
    discovery: ['manual_link'],
    applyMethods: ['ats_form', 'email'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: false,
    rateLimit: null,
    policyReview: NOT_REVIEWED(
      'Each ATS vendor gets its own reviewed declaration. Several publish public job-board APIs, ' +
        'which are the most likely first automated discovery sources.',
    ),
  },
};
