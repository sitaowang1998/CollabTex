import { test, expect } from "@playwright/test";

test.describe("Auth flow", () => {
  test("register new user redirects to dashboard", async ({ page }) => {
    await page.goto("/register");

    await page.getByLabel("Email").fill(`reg-${Date.now()}@test.com`);
    await page.getByLabel("Name").fill("Test User");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });

  test("login with registered user redirects to dashboard", async ({
    page,
  }) => {
    const email = `login-${Date.now()}@test.com`;
    const password = "password123";

    // Register first
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Name").fill("Login Test");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/");

    // Log out by clearing localStorage, then navigate to force React re-init
    await page.evaluate(() => localStorage.clear());
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });

  test("login with wrong credentials shows error", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email").fill("wrong@test.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("empty login form shows validation errors", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
  });

  test("empty register form shows validation errors", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("Name is required")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
  });

  test("invalid email on register shows validation error", async ({ page }) => {
    await page.goto("/register");

    await page.getByLabel("Email").fill("notanemail");
    await page.getByLabel("Name").fill("Test");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });

  test("can navigate between login and register", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

    await page.getByRole("link", { name: /register/i }).click();
    await expect(page).toHaveURL("/register");
    await expect(
      page.getByRole("heading", { name: "Create account" }),
    ).toBeVisible();

    await page.getByRole("link", { name: /log in/i }).click();
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  });

  test("protected route redirects to login then back after auth", async ({
    page,
  }) => {
    const email = `redirect-${Date.now()}@test.com`;

    // Register a user first
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Name").fill("Redirect Test");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/");

    // Clear auth, then navigate to force React re-init — should redirect to /login
    await page.evaluate(() => localStorage.clear());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL("/login");

    // Login
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Log in" }).click();

    // Should redirect back to /
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });

  test("submit button is disabled while request is in flight", async ({
    page,
  }) => {
    await page.goto("/login");

    await page.getByLabel("Email").fill("inflight@test.com");
    await page.getByLabel("Password").fill("password123");

    const button = page.getByRole("button", { name: "Log in" });
    await button.click();

    // The button should briefly show loading state
    await expect(
      page.getByRole("button", { name: /logging in/i }),
    ).toBeVisible();
  });
});
