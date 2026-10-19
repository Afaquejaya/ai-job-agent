# Job source connectors

> Status: **job search from the CV is live (D-049, pulled forward from Phase 6).** Five
> discovery sources read published job-search APIs (`packages/job-sources/src/search.ts`):
> JSearch (with the user's own key), Greenhouse, Lever and Ashby company boards, and Remotive.
> They only read listings: no sign-in, no applying, no scraping. Indeed, LinkedIn, Naukri and
> Naukri Gulf stay `manual_link`; their listings reach the user through JSearch (Google Jobs).

## Principles

1. **One connector per source.** Each connector has its own health status, error reporting and
   rate limit. One broken source never stops the others.
2. **Declare, then enforce.** Every source has a `SourceDeclaration`: discovery methods, apply
   methods, automation permissions, rate limit, and a policy-review record. The policy engine
   reads declarations **server-side**. A connector cannot grant itself extra permissions.
3. **Deny by default.** Automation is off until the source's terms have been reviewed and the
   declaration is changed in a code-reviewed commit. `declarationProblems()` rejects automation
   on an unreviewed source, and a unit test checks every registry entry.
4. **Never work around a wall.** On login walls, CAPTCHA, OTP, access denial or rate limiting, a
   connector stops and reports (`ConnectorError` with `auth_required`, `blocked` or
   `rate_limited`). It never retries harder, rotates identities or spoofs clients.
5. **Raw in, normalized out.** Connectors return `RawJobPosting` (source payload plus metadata).
   `job-processing` turns them into `NormalizedJob`.

## Interface

```ts
interface JobSourceConnector {
  readonly declaration: SourceDeclaration;
  search(query: JobSearchQuery, ctx: ConnectorContext): AsyncIterable<RawJobPosting>;
  checkHealth(ctx: ConnectorContext): Promise<ConnectorHealth>;
}
```

- `search` streams results so large result sets do not have to fit in memory, and so a
  cancellation (`ctx.signal`) stops fetching immediately.
- `ConnectorContext` carries `userId`, `connectorRunId`, an `AbortSignal` and a logger. Every run
  is recorded in `connector_runs` (see [database-design.md](database-design.md)).
- `ConnectorHealth` (`healthy | degraded | down | disabled | unknown`) includes the last error
  and the recent success rate. The dashboard and morning report show it.

## Capability registry

`SOURCE_REGISTRY` in `packages/job-sources/src/registry.ts`:

| Source               | Countries | Discovery today | Automation | Policy review                                                                                       |
| -------------------- | --------- | --------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| Indeed               | IN, GCC   | `manual_link`   | none       | not reviewed                                                                                        |
| LinkedIn             | IN, GCC   | `manual_link`   | none       | not reviewed. Its user agreement is expected to restrict automated access; plan for manual handoff. |
| Naukri.com           | IN        | `manual_link`   | none       | not reviewed                                                                                        |
| Naukri Gulf          | GCC       | `manual_link`   | none       | not reviewed                                                                                        |
| Company career pages | IN, GCC   | `manual_link`   | none       | not reviewed. Each ATS vendor gets its own declaration.                                             |

| JSearch | IN, GCC | `official_api` (user's key) | none | reviewed: max 3 requests per search |
| Greenhouse boards | IN, GCC | `public_job_board_api` | none | reviewed: 1 GET per company board |
| Lever boards | IN, GCC | `public_job_board_api` | none | reviewed: 1 GET per company |
| Ashby boards | IN, GCC | `public_job_board_api` | none | reviewed: 1 GET per company |
| Remotive | remote | `public_job_board_api` | none | reviewed: 1 request per search |

GCC = AE, SA, QA, KW, BH, OM.

### How a search works (D-049)

1. **Plan (no AI):** roles from the profile's current role and the CV headline, the CV's most
   mentioned skill, and countries from the profile (default IN). The user can edit it.
2. **Fetch:** every enabled source in parallel, 60 s each. A 401/403/429 stops that source
   (reported, never worked around); a missing company board is skipped.
3. **Filter:** in the user's countries, or remote and open to them (a remote job limited to the
   US, UK, Europe... is dropped); the title names a searched word, one of the CV's main
   skills, or a whole searched role; description long enough to analyse; duplicates removed.
4. **Rank:** skills pre-score against the CV, weighted so a listing naming few skills does not
   win on 100%, with a boost when the title names a main CV skill; max 5 per company.
5. **Save:** up to 25 new jobs per search (pre-score 30%+), with their source and link, as a
   `job_search` task on `agent-tasks` (visible on the Activity page). "Other supported sources" are added the same way: a new
   `SourceId`, a declaration, and a reviewed connector.

### Declaration fields

| Field                            | Meaning                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `discovery`                      | Allowed ways to find jobs: `official_api`, `public_job_board_api`, `rss_feed`, `user_assisted_browser`, `manual_link`, `none` |
| `applyMethods`                   | `external_redirect`, `on_platform_form`, `ats_form`, `email`                                                                  |
| `automation.autoFillPermitted`   | The agent may fill the form for the user                                                                                      |
| `automation.autoSubmitPermitted` | The agent may press submit (requires auto-fill and a reviewed policy)                                                         |
| `requiresUserSession`            | Needs the user's own logged-in session, so it only works through the extension or local agent                                 |
| `rateLimit`                      | Our self-imposed ceiling, at or below the source's published limits. Required before `active`.                                |
| `policyReview`                   | Who checked what (terms, robots.txt, API terms), when, and the conclusion                                                     |

### Promoting a source (process)

1. Read the source's terms of service, API terms and robots.txt. Record the findings in
   `policyReview.notes`.
2. Choose the least intrusive discovery method that works: official API, then public job-board
   API or feed, then user-assisted browsing, then manual links.
3. Set automation flags only where they are explicitly allowed. If in doubt, leave them `false`.
   The result is a manual handoff, which still saves the user most of the work.
4. Add a connector with recorded fixtures (`tests/fixtures`) and contract tests.
5. Set `implementationStatus` to `experimental` and then to `active` once the success rate is
   stable.

## Fallback strategies

Each source can define an ordered `FallbackStep[]`:

- `{ type: 'connector', sourceId }`: try a different permitted source for the same search.
- `{ type: 'retry_later' }`: schedule a retry within the task deadline.
- `{ type: 'ask_user_for_links' }`: ask the user to paste links, which are imported through
  `manual_link`.

Fallback never means "try a less compliant method on the same source".

## Error reporting

| `ConnectorErrorCode`            | Typical cause                    | Recovery                              |
| ------------------------------- | -------------------------------- | ------------------------------------- |
| `network`                       | timeout, DNS, 5xx                | transient retry                       |
| `rate_limited`                  | 429 / Retry-After                | wait at least Retry-After             |
| `auth_required`                 | login wall                       | stop; source needs the user's session |
| `blocked`                       | CAPTCHA, access denied           | stop; mark source `degraded`; report  |
| `parse_error`, `schema_changed` | site changed                     | stop connector; mark `down`; alert    |
| `policy_disabled`               | declaration disallows the action | stop; nothing to retry                |

## Likely first automated sources

Several applicant tracking systems (ATS) used by company career pages publish public, documented
job-board APIs. These are the most likely first `public_job_board_api` connectors, after each
one's terms are reviewed. The large job boards are expected to start as `manual_link` and
assisted-browsing sources with manual handoff.
