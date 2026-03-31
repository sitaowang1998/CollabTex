import { test, expect } from "@playwright/test";

/** Register a fresh user and land on the dashboard. */
async function registerAndLand(page: import("@playwright/test").Page) {
  const email = `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill("Error UI Tester");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  return email;
}

test.describe("Error UI", () => {
  test("404 page shows not found with navigation", async ({ page }) => {
    await page.goto("/nonexistent-path-12345");
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(
      page.getByText(/does not exist or has been moved/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to Dashboard" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
  });

  test("404 Back to Dashboard navigates to login when unauthenticated", async ({
    page,
  }) => {
    await page.goto("/nonexistent-path-12345");
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    // Unauthenticated users get redirected to /login
    await expect(page).toHaveURL("/login");
  });

  test("login form shows validation errors on empty submit", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
  });

  test("login with invalid credentials shows error banner", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nonexistent@test.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Log in" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("invalid email or password");
  });

  test("register with duplicate email shows error banner", async ({ page }) => {
    const email = `dup-${Date.now()}@test.com`;

    // Register first user
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Name").fill("First User");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/");

    // Log out and try to register with same email
    await page.evaluate(() => localStorage.clear());
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Name").fill("Duplicate User");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("email already registered");
  });

  test("dashboard recovers from network error on retry", async ({ page }) => {
    await registerAndLand(page);

    // Intercept the projects API to simulate a network error
    await page.route("**/api/projects", (route) => route.abort());

    // Navigate away and back to trigger a re-fetch
    await page.goto("/login");
    await page.goto("/");

    // Assert error UI appears
    await expect(page.getByText("Something went wrong")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    // Unblock the route, then click Retry
    await page.unroute("**/api/projects");
    await page.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  });

  test("project editor shows error for non-existent project", async ({
    page,
  }) => {
    await registerAndLand(page);

    // Navigate to a project that doesn't exist
    await page.goto("/projects/00000000-0000-0000-0000-000000000000");

    await expect(page.getByText("Something went wrong")).toBeVisible();
    await expect(page.getByText("project not found")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to Dashboard" }),
    ).toBeVisible();

    // Click back to dashboard
    await page.getByRole("button", { name: "Back to Dashboard" }).click();
    await expect(page).toHaveURL("/");
  });

  test("cleared session redirects to login", async ({ page }) => {
    await registerAndLand(page);

    // Clear auth
    await page.evaluate(() => localStorage.clear());
    await page.goto("/");

    // ProtectedRoute should redirect to /login
    await expect(page).toHaveURL("/login");
  });
});
