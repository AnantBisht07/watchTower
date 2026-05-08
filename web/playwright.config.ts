import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "..");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8123",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] }
    }
  ],
  webServer: {
    command: "python -m uvicorn mcp_watchtower.server:app --host 127.0.0.1 --port 8123",
    cwd: repoRoot,
    env: {
      PYTHONPATH: repoRoot,
      WATCHTOWER_DB_PATH: path.join(repoRoot, ".watchtower", "playwright.db")
    },
    reuseExistingServer: false,
    timeout: 20_000,
    url: "http://127.0.0.1:8123"
  }
});
