import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Third arg '' (not the default 'VITE_') so this also loads the three unprefixed, build-time-
  // only Sentry credentials from .env.local — bare process.env does NOT reflect .env.local
  // contents inside vite.config.js, only loadEnv() does (verified directly: a build run without
  // this returned "no auth token provided" despite the token being present in client/.env.local).
  const env = loadEnv(mode, process.cwd(), '');

  // TASK-068: byte-for-byte release identity is required (spec §2.4/criterion 12/17) — forced
  // explicitly rather than left to the plugin's own auto-detection, and injected into
  // import.meta.env under a VITE_-prefixed name (not a secret; already exposed elsewhere via
  // server/routes/clientErrors.js's deploy field) so instrument.js can read it like any other
  // client env var.
  const releaseSha = env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';

  return {
    plugins: [
      react(),
      sentryVitePlugin({
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        release: { name: releaseSha },
        sourcemaps: {
          filesToDeleteAfterUpload: ['./dist/**/*.map'],
        },
        // Absent build-time credentials must not fail the build (spec §2.1a) — the plugin
        // already no-ops gracefully when org/project/authToken aren't all present.
      }),
    ],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: true },
      },
    },
    build: {
      // 'hidden': maps are generated (for the plugin to upload) but not publicly referenced via
      // a //# sourceMappingURL comment in the shipped bundle.
      sourcemap: 'hidden',
    },
    define: {
      'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(releaseSha),
    },
  };
});
