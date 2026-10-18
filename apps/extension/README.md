# Chrome extension (Manifest V3)

**Phase 1 status:** placeholder folder only. No extension code or manifest exists yet, so
there is nothing to load in Chrome. Implementation is planned for Phase 9.

## Planned role

The extension works inside the user's **own** browser, on the page the user has open:

- Detects a job posting or an application form and sends a structured summary to the backend
  (with the user's consent and an extension-scoped token).
- Fills form fields **only** with the user's verified answers, then leaves the final submit to
  the user unless the source and user settings both allow automation.
- Never reads or exports cookies, passwords or other site credentials.

**Extension or local agent?** The extension helps while the user is browsing. The local browser
agent ([apps/browser-agent](../browser-agent)) runs permitted workflows in a separate profile
when the user is not watching. Both use the same backend policy engine.
