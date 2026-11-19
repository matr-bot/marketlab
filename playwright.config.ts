import { defineConfig, devices } from "@playwright/test";

// Browser smoke tests against the production build (CLAUDE.md, Daily process). CI builds first;
// locally an already-running server on the port is reused.
const PORT = 3100;
const viewport = process.env.E2E_VIEWPORT === "1280x720" ? { width: 1280, height: 720 } : { width: 1440, height: 900 };

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}` },
  // Every spec in Chromium; the determinism check also in Firefox and WebKit (D-091), whose JavaScript
  // engines (SpiderMonkey, JavaScriptCore) must reproduce the same market bit for bit.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport } },
    { name: "firefox", testMatch: /determinism\.spec\.ts/, use: { ...devices["Desktop Firefox"], viewport } },
    { name: "webkit", testMatch: /determinism\.spec\.ts/, use: { ...devices["Desktop Safari"], viewport } },
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
