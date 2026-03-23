import { test, expect } from "@playwright/test";

/** Register a fresh user and land on the dashboard. */
async function registerAndLand(page: import("@playwright/test").Page) {
  const email = `dash-${Date.now()}@test.com`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill("Dashboard Tester");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  return email;
}

test.describe("Dashboard", () => {
  test("empty dashboard shows empty state", async ({ page }) => {
    await registerAndLand(page);
    await expect(page.getByText(/don't have any projects/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create your first project/i }),
    ).toBeVisible();
  });

  test("create project from empty state CTA", async ({ page }) => {
    await registerAndLand(page);

    await page
      .getByRole("button", { name: /create your first project/i })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel("Project name").fill("My First Project");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();

    await expect(page.getByText("My First Project")).toBeVisible();
    // Empty state should be gone
    await expect(page.getByText(/don't have any projects/i)).not.toBeVisible();
  });

  test("create project from New Project button", async ({ page }) => {
    await registerAndLand(page);

    // Create first project via CTA
    await page
      .getByRole("button", { name: /create your first project/i })
      .click();
    await page.getByLabel("Project name").fill("Project One");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(page.getByText("Project One")).toBeVisible();

    // Create second via New Project button
    await page.getByRole("button", { name: /new project/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Project name").fill("Project Two");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();

    await expect(page.getByText("Project One")).toBeVisible();
    await expect(page.getByText("Project Two")).toBeVisible();
  });

  test("create modal validates empty name", async ({ page }) => {
    await registerAndLand(page);

    await page
      .getByRole("button", { name: /create your first project/i })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();

    await expect(page.getByText("Project name is required")).toBeVisible();
    // Modal should still be open
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("create modal input has maxLength 160", async ({ page }) => {
    await registerAndLand(page);

    await page
      .getByRole("button", { name: /create your first project/i })
      .click();

    const input = page.getByLabel("Project name");
    await expect(input).toHaveAttribute("maxLength", "160");
  });

  test("click project card navigates to project page", async ({ page }) => {
    await registerAndLand(page);

    // Create a project
    await page
      .getByRole("button", { name: /create your first project/i })
      .click();
    await page.getByLabel("Project name").fill("Navigate Test");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(page.getByText("Navigate Test")).toBeVisible();

    // Click the project card
    await page.getByText("Navigate Test").click();
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/);
  });

  test("logout from dashboard redirects to login", async ({ page }) => {
    await registerAndLand(page);

    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL("/login");
  });
});
