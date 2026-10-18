import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Local development keeps one .env at the repository root. Next.js only reads env files from
// apps/web, so load the root file too. Hosted builds (Vercel) inject variables directly.
const workspaceRoot = path.resolve(process.cwd(), '../..');
if (existsSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'))) {
  loadEnvConfig(workspaceRoot);
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
    '@job-agent/observability',
    '@job-agent/security',
    '@job-agent/shared',
  ],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
