import { defineConfig } from "@playwright/test";

/**
 * TrueClick E2E config.
 *
 * The suite drives one shared headed Chromium with the unpacked extension
 * loaded, so it must run serially in a single worker. MV3 service workers are
 * flaky headless, so headed is not optional here.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /e2e\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
