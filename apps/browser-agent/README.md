# @job-agent/browser-agent

Local browser agent that runs **on the user's computer**, not in the cloud.

**Phase 1 status:** only interfaces exist (`src/index.ts`). Nothing runs yet, and there is no
`start` script on purpose. Implementation is planned for Phase 9.

## Planned behaviour

- The user pairs the agent from the web app with a one-time code. The agent receives a device
  credential, stored locally, which the user can revoke from the web app.
- The agent opens **outbound** HTTPS connections only, so it needs no open ports or tunnels.
- It runs Playwright with a **dedicated browser profile** (`BROWSER_AGENT_PROFILE_DIR`). The
  profile, cookies and sessions stay on the machine and are git-ignored.
- It executes short-lived commands defined in `@job-agent/shared` (`browser-agent-protocol.ts`)
  and stops with a `blocked` result on CAPTCHA, OTP, login walls or rate limits.

See [docs/architecture/security-and-permissions.md](../../docs/architecture/security-and-permissions.md)
and [docs/architecture/deployment.md](../../docs/architecture/deployment.md).
