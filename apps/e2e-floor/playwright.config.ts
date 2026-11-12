import { defineConfig } from "@playwright/test";
import shared from "../e2e-app/playwright.config";
export default defineConfig({
  ...shared,
  testDir: "..",
  testMatch: ["**/e2e-app/tests/**/*.spec.ts", "**/e2e-floor/tests/**/*.spec.ts"],
  webServer: {
    command: "pnpm dev --strictPort",
    port: 5174,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
