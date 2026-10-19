import type { SourceDeclaration, SourceId } from './declaration';

const GCC = ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'];

const REVIEWED = (notes: string): SourceDeclaration['policyReview'] => ({
  status: 'reviewed',
  reviewedAt: '2026-10-19T00:00:00.000Z',
  notes,
});

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
  // Discovery only (D-049): these read published job-search APIs. They never sign in, apply or
  // fill forms; applying stays a manual hand-off on the employer's own page.
  jsearch: {
    sourceId: 'jsearch',
    displayName: 'JSearch (Google Jobs: LinkedIn, Indeed, Naukri and more)',
    countries: ['IN', ...GCC],
    implementationStatus: 'experimental',
    discovery: ['official_api'],
    applyMethods: ['external_redirect'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: false,
    rateLimit: { requestsPerMinute: 5, requestsPerDay: 20 },
    policyReview: REVIEWED(
      'Commercial API sold for job search, used with the user’s own key (JSEARCH_API_KEY). ' +
        'Free plan has a small monthly quota, so each search makes at most 3 requests. ' +
        'Listings link to the original posting; nothing is fetched from the job sites themselves.',
    ),
  },
  greenhouse: {
    sourceId: 'greenhouse',
    displayName: 'Company career pages (Greenhouse)',
    countries: ['IN', ...GCC],
    implementationStatus: 'experimental',
    discovery: ['public_job_board_api'],
    applyMethods: ['ats_form'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: false,
    rateLimit: { requestsPerMinute: 30, requestsPerDay: 500 },
    policyReview: REVIEWED(
      'Greenhouse Job Board API (boards-api.greenhouse.io) is public and unauthenticated for ' +
        'listing a company’s open jobs. One GET per company board per search.',
    ),
  },
  lever: {
    sourceId: 'lever',
    displayName: 'Company career pages (Lever)',
    countries: ['IN', ...GCC],
    implementationStatus: 'experimental',
    discovery: ['public_job_board_api'],
    applyMethods: ['ats_form'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: false,
    rateLimit: { requestsPerMinute: 30, requestsPerDay: 500 },
    policyReview: REVIEWED(
      'Lever Postings API (api.lever.co/v0/postings) is public for published job postings. ' +
        'One GET per company per search.',
    ),
  },
  ashby: {
    sourceId: 'ashby',
    displayName: 'Company career pages (Ashby)',
    countries: ['IN', ...GCC],
    implementationStatus: 'experimental',
    discovery: ['public_job_board_api'],
    applyMethods: ['ats_form'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: false,
    rateLimit: { requestsPerMinute: 30, requestsPerDay: 500 },
    policyReview: REVIEWED(
      'Ashby public job posting API (api.ashbyhq.com/posting-api/job-board) is published for ' +
        'job boards. One GET per company per search.',
    ),
  },
  remotive: {
    sourceId: 'remotive',
    displayName: 'Remotive (remote jobs)',
    countries: ['IN', ...GCC],
    implementationStatus: 'experimental',
    discovery: ['public_job_board_api'],
    applyMethods: ['external_redirect'],
    automation: { autoFillPermitted: false, autoSubmitPermitted: false },
    requiresUserSession: false,
    rateLimit: { requestsPerMinute: 2, requestsPerDay: 4 },
    policyReview: REVIEWED(
      'Remotive public API asks for few requests a day and a link back to the listing on ' +
        'Remotive; each result keeps its Remotive link. One request per search.',
    ),
  },
};
