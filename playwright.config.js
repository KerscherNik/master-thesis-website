const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure"
  },
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: true,
    timeout: 15000
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
      testIgnore: /mobile\.spec\.js/
    },
    /* touch emulation (isMobile + hasTouch + coarse pointer); Chromium engine,
       so responsive/interaction behaviour is covered — engine-specific iOS
       Safari bugs still need a real device */
    {
      name: "phone",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
      testMatch: /mobile\.spec\.js/
    },
    {
      name: "tablet",
      use: { ...devices["iPad (gen 7)"], browserName: "chromium" },
      testMatch: /mobile\.spec\.js/
    }
  ]
});
