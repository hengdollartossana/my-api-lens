import "dotenv/config";
import { defineConfig } from "@playwright/test";

// Ports come from .env (see AGENTS.md); never hardcode 3000 / 4010.
const appPort = Number(process.env.APP_PORT ?? 3000);
const mockPort = Number(process.env.MOCK_API_PORT ?? 4010);

export default defineConfig({
  testDir: "e2e",
  // One long happy-path scenario that shares the dev database.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${appPort}`,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npx tsx fixtures/mock-api/server.ts",
      port: mockPort,
      reuseExistingServer: true,
      env: { MOCK_API_PORT: String(mockPort) },
      timeout: 60_000,
    },
    {
      command: `npx next dev -p ${appPort}`,
      url: `http://localhost:${appPort}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
