import { test, expect } from "@playwright/test";

async function registerAndCreateProject(
  page: import("@playwright/test").Page,
  projectName: string,
) {
  const email = `pdf-${Date.now()}@test.com`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill("PDF Tester");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");

  await page
    .getByRole("button", { name: /create your first project/i })
    .click();
  await page.getByLabel("Project name").fill(projectName);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create" })
    .click();
  await expect(page.getByText(projectName)).toBeVisible();

  await page.getByText(projectName).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/);
}

test.describe("PDF Preview Panel", () => {
  test("shows preview panel with Compile button for editor", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "PDF Preview Project");

    // Preview panel should be visible with Compile button
    await expect(page.getByText("Preview")).toBeVisible();
    await expect(page.getByRole("button", { name: "Compile" })).toBeVisible();
  });

  test("shows no compiled PDF message initially", async ({ page }) => {
    await registerAndCreateProject(page, "PDF No Build Project");

    await expect(
      page.getByText("No compiled PDF. Click Compile to build."),
    ).toBeVisible();
  });

  test("compile button triggers compilation and shows result", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "PDF Compile Project");

    // Click main.tex to ensure we have a document open
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    // Click Compile
    await page.getByRole("button", { name: "Compile" }).click();

    // Should show compiling state
    await expect(
      page.getByRole("button", { name: "Compiling…" }),
    ).toBeVisible();

    // Wait for compile to finish — either success (iframe) or failure (logs)
    await expect(
      page.getByTitle("PDF preview").or(page.getByText("Compile logs:")),
    ).toBeVisible({ timeout: 30000 });
  });

  test("preview panel can be collapsed and expanded", async ({ page }) => {
    await registerAndCreateProject(page, "PDF Collapse Project");

    // Collapse the preview panel
    await page.getByRole("button", { name: "Collapse preview" }).click();

    // Compile button should not be visible when collapsed
    await expect(
      page.getByRole("button", { name: "Compile" }),
    ).not.toBeVisible();

    // Expand the preview panel
    await page.getByRole("button", { name: "Expand preview" }).click();

    // Compile button should be visible again
    await expect(page.getByRole("button", { name: "Compile" })).toBeVisible();
  });
});
