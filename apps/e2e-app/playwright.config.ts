import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    viewport: { width: 1280, height: 720 },
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "pnpm dev --strictPort",
    port: 5174,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
