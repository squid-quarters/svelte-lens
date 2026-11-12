import { defineConfig } from "@playwright/test";
import shared from "../e2e-app/playwright.config";
export default defineConfig({
  ...shared,
  testDir: "../e2e-app/tests",
  webServer: {
    command: "pnpm dev --strictPort",
    port: 5174,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
