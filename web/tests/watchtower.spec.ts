import { expect, test } from "@playwright/test";

test("makes a pending approval the main control-tower story", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "MCP Watchtower" })).toBeVisible();
  await expect(page.getByText("Live execution cockpit for MCP agents")).toBeVisible();

  await page.getByRole("button", { name: "Safety Demo", exact: true }).click();

  const hero = page.locator(".runHero");
  await expect(hero.getByRole("heading", { name: "Human approval required" })).toBeVisible({
    timeout: 10_000
  });
  await expect(hero.getByText("filesystem.write_file").first()).toBeVisible();
  await expect(hero.getByText("Watchtower paused the MCP call before execution")).toBeVisible();
  await expect(hero.getByText("summary.md").first()).toBeVisible();
  await expect(hero.getByText("MCP call paused")).toBeVisible();
  await expect(hero.getByRole("button", { name: "Approve and Forward" })).toBeVisible();
  await expect(hero.getByRole("button", { name: "Reject and Block" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Watchtower intercepts before MCP execution" })).toBeVisible();
  await expect(page.locator(".routeStep").filter({ hasText: "Watchtower" }).filter({ hasText: "Intercepted request" })).toBeVisible();
  await expect(page.locator(".routeStep.warning").filter({ hasText: "Policy Check" })).toBeVisible();
  await expect(page.locator(".routeStep.warning").filter({ hasText: "Approval Gate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval Gate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();
  await expect(page.getByText("Policy requires approval").first()).toBeVisible();
  await expect(page.getByText("approval gate").first()).toBeVisible();
  await expect(page.getByText("If approved")).toBeVisible();
  await expect(page.getByText("Watchtower will forward this request")).toBeVisible();
  await expect(page.getByText("Raw event JSON")).toBeVisible();

  await expect(page.locator(".valueCard")).toHaveCount(0);
  await expect(page.locator(".metricsGrid")).toHaveCount(0);

  const bodyBox = await page.locator(".timelineRow .timelineBody").first().boundingBox();
  expect(bodyBox?.width ?? 0).toBeGreaterThan(220);

  await hero.getByRole("button", { name: "Approve and Forward" }).click();
  const completedHero = page.locator(".runHero");
  await expect(completedHero.getByRole("heading", { name: "Run completed" })).toBeVisible({
    timeout: 10_000
  });
  await expect(completedHero.getByText("Watchtower approved, forwarded, and recorded")).toBeVisible();
  await expect(page.locator(".routeStep.completed").filter({ hasText: "Approved by human" })).toBeVisible();
  await expect(page.locator(".routeStep.completed").filter({ hasText: "Tool returned result" })).toBeVisible();
  await expect(page.getByText("Approved and forwarded")).toBeVisible();
  await expect(page.getByText("Watchtower forwarded call")).toBeVisible();
  await expect(page.getByText("Tool completed")).toBeVisible();
});

test("keeps the control-tower layout usable on narrow screens", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Journey Demo", exact: true }).click();

  await expect(page.getByRole("heading", { name: "MCP Watchtower" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Agent execution in progress|Run completed/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Watchtower intercepts before MCP execution" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Event Details|Run Context|Approval Gate/ })).toBeVisible();

  const bodyBox = await page.locator(".timelineRow .timelineBody").first().boundingBox();
  expect(bodyBox?.width ?? 0).toBeGreaterThan(220);
});
