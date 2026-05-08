import { expect, test } from "@playwright/test";

test("makes a pending approval the main run story", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "MCP Watchtower" })).toBeVisible();
  await expect(page.getByText("Live control layer for MCP agents")).toBeVisible();

  await page.getByRole("button", { name: "Safety demo", exact: true }).click();

  const hero = page.locator(".stateHero");
  await expect(hero.getByRole("heading", { name: "Watchtower paused a risky tool call" })).toBeVisible({
    timeout: 10_000
  });
  await expect(hero.getByText("filesystem.write_file").first()).toBeVisible();
  await expect(hero.getByText("Watchtower intercepted this request before it reached the MCP server")).toBeVisible();
  await expect(hero.getByText("summary.md").first()).toBeVisible();
  await expect(hero.getByText("Not executed yet")).toBeVisible();
  await expect(hero.getByText("Waiting for your decision").first()).toBeVisible();
  await expect(hero.getByRole("button", { name: "Approve and forward to MCP" })).toBeVisible();
  await expect(hero.getByRole("button", { name: "Reject and block tool call" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Why this matters" })).toBeVisible();
  await expect(page.getByText("Without Watchtower, the agent could call filesystem.write_file directly")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How Watchtower is controlling this run" })).toBeVisible();
  await expect(page.getByText("The agent does not call the MCP tool directly")).toBeVisible();
  await expect(page.locator(".flowNode.warning").filter({ hasText: "holding for approval" })).toBeVisible();
  await expect(page.locator(".flowNode.neutral").filter({ hasText: "not executed yet" })).toBeVisible();
  await expect(page.locator(".routeNode.blocked").filter({ hasText: "Paused for approval" })).toBeVisible();
  await expect(page.locator(".routeNode").filter({ hasText: "Forwarded to MCP" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How Watchtower handled the tool call" })).toBeVisible();
  await expect(page.getByText("Phase 2: Safety intervention")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Details", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tool Health" })).toBeVisible();
  await expect(page.getByText("Show raw event JSON")).toBeVisible();
  await expect(page.getByText("Watchtower detected risk")).toBeVisible();
  await expect(page.getByText("Watchtower paused the tool call").first()).toBeVisible();
  await expect(page.getByText("Key intervention").first()).toBeVisible();
  await expect(page.getByText("If you approve:")).toBeVisible();
  await expect(page.getByText("Watchtower will forward this request")).toBeVisible();

  await expect(page.locator(".valueCard")).toHaveCount(0);
  await expect(page.locator(".metricsGrid")).toHaveCount(0);

  const bodyBox = await page.locator(".journeyStep .stepContent").first().boundingBox();
  expect(bodyBox?.width ?? 0).toBeGreaterThan(220);

  await hero.getByRole("button", { name: "Approve and forward to MCP" }).click();
  const completedHero = page.locator(".stateHero");
  await expect(completedHero.getByRole("heading", { name: "Watchtower protected this run" })).toBeVisible({
    timeout: 10_000
  });
  await expect(completedHero.getByText("only forwarded it to MCP after a human approved")).toBeVisible();
  await expect(completedHero.getByText("Approved", { exact: true })).toBeVisible();
  await expect(completedHero.getByText("Forwarded + executed")).toBeVisible();
  await expect(page.locator(".routeNode.keyMoment").filter({ hasText: "Watchtower intervened" })).toBeVisible();
  await expect(page.locator(".flowNode.brand").filter({ hasText: "approved and forwarded" })).toBeVisible();
  await expect(page.locator(".flowNode.success").filter({ hasText: "executed safely" })).toBeVisible();
  await expect(page.getByText("Approved and executed safely")).toBeVisible();
  await expect(page.getByText("Human approved the request")).toBeVisible();
  await expect(page.getByText("Watchtower forwarded the call to MCP")).toBeVisible();
  await expect(page.getByText("MCP tool executed successfully")).toBeVisible();
});

test("keeps the run story layout usable on narrow screens", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Journey demo", exact: true }).click();

  await expect(page.getByRole("heading", { name: "MCP Watchtower" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Agent journey/ })).toBeVisible();
  await expect(page.getByText("The agent does not call the MCP tool directly")).toBeVisible();
  await expect(page.getByText("Where Watchtower intervened and how the run finished")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How Watchtower handled the tool call" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Details", exact: true })).toBeVisible();

  const bodyBox = await page.locator(".journeyStep .stepContent").first().boundingBox();
  expect(bodyBox?.width ?? 0).toBeGreaterThan(220);
});
