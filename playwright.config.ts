import { defineConfig, devices } from '@playwright/test'

// R13: the camera is faked with a committed Y4M fixture so an end-to-end run captures
// deterministic samples. Without --use-file-for-fake-video-capture the run would train
// on a black frame and every accuracy assertion would be meaningless.
const fakeCameraFlags = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--use-file-for-fake-video-capture=tests/fixtures/camera.y4m',
]

const noWebglFlags = ['--disable-gpu', '--disable-webgl', '--disable-webgl2']

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      // SC-004: 360 px is the constitutional floor, so mobile is a first-class project,
      // not an afterthought appended to the desktop run.
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 740 },
        launchOptions: { args: fakeCameraFlags },
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: fakeCameraFlags },
      },
    },
    {
      // SC-012: the WASM fallback must be exercised, not merely configured.
      name: 'chromium-nowebgl',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: [...fakeCameraFlags, ...noWebglFlags] },
      },
    },
  ],
})
