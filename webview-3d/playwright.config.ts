import { defineConfig } from '@playwright/test';

// Headless Chromium falls back to software GL, which renders this scene at seconds per frame.
// On a Mac, ANGLE-on-Metal is what the look-dev shots and perf budget are measured with.
const gpuArgs =
  process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : [];

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // `@frames` renders the look-dev images on demand: `npm run frames` (see docs/superpowers/m1).
  grepInvert: process.env['DIWAN_FRAMES'] ? undefined : /@frames/,
  grep: process.env['DIWAN_FRAMES'] ? /@frames/ : undefined,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: gpuArgs },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
