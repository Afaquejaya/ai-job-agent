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
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    '@job-agent/database',
    '@job-agent/documents',
    '@job-agent/observability',
    '@job-agent/security',
    '@job-agent/shared',
    '@job-agent/storage',
  ],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
