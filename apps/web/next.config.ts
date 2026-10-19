import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// Local development keeps one .env at the repository root. Next.js only reads env files from
// apps/web, so load the root file too. Hosted builds (Vercel) inject variables directly.
// Uses Node's loader rather than @next/env: @next/env caches its first load (apps/web), so a
// second call for the root directory silently returned nothing. Existing variables win.
const rootEnvFile = path.resolve(process.cwd(), '../../.env');
if (
  existsSync(path.resolve(process.cwd(), '../../pnpm-workspace.yaml')) &&
  existsSync(rootEnvFile)
) {
  process.loadEnvFile(rootEnvFile);
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // End-to-end tests build into their own folder, so they can run while `pnpm dev` is running.
  // Only set when asked: an explicit distDir (even '.next') made `next dev` watch its own
  // dev log, so every browser console line triggered a rebuild and a full page reload.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Do not copy browser console output into the dev log: the dev server still saw that log
  // change, rebuilt and reloaded the page, which printed to the console again (endless loop).
  logging: { browserToTerminal: false },
  // Redis queue clients load at runtime from node_modules (not bundled).
  serverExternalPackages: ['bullmq', 'ioredis'],
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    '@job-agent/agent-core',
    '@job-agent/ai-providers',
    '@job-agent/database',
    '@job-agent/documents',
    '@job-agent/job-processing',
    '@job-agent/observability',
    '@job-agent/security',
    '@job-agent/services',
    '@job-agent/shared',
    '@job-agent/storage',
    '@job-agent/task-queue',
  ],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
