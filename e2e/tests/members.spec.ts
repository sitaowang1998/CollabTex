import { test, expect } from "@playwright/test";

async function registerUser(
  page: import("@playwright/test").Page,
  name: string,
) {
  const email = `member-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  return email;
}

async function createProjectAndOpen(
  page: import("@playwright/test").Page,
  projectName: string,
) {
  await page
    .getByRole("button", { name: /create your first project/i })
    .click();
  await page.getByLabel("Project name").fill(projectName);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create" })
    .click();
  // Wait for modal to close and project card to appear
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: projectName, exact: true }),
  ).toBeVisible();
  await page.getByRole("heading", { name: projectName, exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/);
}

async function openMembersPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Members" }).click();
  await expect(page.getByTestId("members-panel")).toBeVisible();
}

async function loginUser(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

/**
 * Register a second user in a separate browser context (isolated localStorage).
 * Returns the email. The context/page are closed after registration.
 */
async function registerSecondUser(
  browser: import("@playwright/test").Browser,
  name: string,
) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = await registerUser(page, name);
  await ctx.close();
  return email;
}

test.describe("Members Panel", () => {
  test("toggle members panel from header", async ({ page }) => {
    await registerUser(page, "Toggle Tester");
    await createProjectAndOpen(page, "Toggle Test");

    // Open members panel
    await openMembersPanel(page);
    // Wait for members to load
    await expect(
      page.getByTestId("members-panel").getByText("Toggle Tester"),
    ).toBeVisible();

    // Close members panel via close button
    await page.getByLabel("Close members panel").click();
    await expect(page.getByTestId("members-panel")).not.toBeVisible();
  });

  test("shows current user as admin", async ({ page }) => {
    await registerUser(page, "Admin Viewer");
    await createProjectAndOpen(page, "Admin View Test");
    await openMembersPanel(page);

    const panel = page.getByTestId("members-panel");
    await expect(panel.getByText("Admin Viewer")).toBeVisible();
    await expect(panel.getByText("(you)")).toBeVisible();
  });

  test("add member by email", async ({ page, browser }) => {
    await registerUser(page, "Admin User");
    await createProjectAndOpen(page, "Add Member Test");

    const secondEmail = await registerSecondUser(browser, "Second User");

    await openMembersPanel(page);
    const panel = page.getByTestId("members-panel");
    await panel.getByPlaceholder("Email address").fill(secondEmail);
    await panel.getByRole("button", { name: "Add" }).click();

    await expect(panel.getByText("Second User")).toBeVisible();
  });

  test("change member role", async ({ page, browser }) => {
    await registerUser(page, "Role Admin");
    await createProjectAndOpen(page, "Role Change Test");

    const secondEmail = await registerSecondUser(browser, "Role Target");

    await openMembersPanel(page);
    const panel = page.getByTestId("members-panel");
    await panel.getByPlaceholder("Email address").fill(secondEmail);
    await panel.getByRole("button", { name: "Add" }).click();
    await expect(panel.getByText("Role Target")).toBeVisible();

    await panel.getByLabel("Role for Role Target").selectOption("commenter");

    // Confirm role change dialog
    const dialog = page.getByRole("dialog", { name: "Change Role" });
    await expect(
      dialog.getByText("Change Role Target's role to commenter?"),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Change" }).click();

    await expect(panel.getByLabel("Role for Role Target")).toHaveValue(
      "commenter",
    );
  });

  test("remove member and verify access revoked", async ({ page, browser }) => {
    await registerUser(page, "Remove Admin");
    await createProjectAndOpen(page, "Remove Test");
    const projectUrl = page.url();

    const secondEmail = await registerSecondUser(browser, "Remove Target");

    // Add then remove
    await openMembersPanel(page);
    const panel = page.getByTestId("members-panel");
    await panel.getByPlaceholder("Email address").fill(secondEmail);
    await panel.getByRole("button", { name: "Add" }).click();
    await expect(panel.getByText("Remove Target")).toBeVisible();

    await panel.getByLabel("Remove Remove Target").click();
    await expect(panel.getByText("Remove Target")).not.toBeVisible();

    // Verify removed user cannot access project
    const ctx = await browser.newContext();
    const page3 = await ctx.newPage();
    await loginUser(page3, secondEmail);
    await page3.goto(projectUrl);
    await expect(page3.getByText("Project not found")).toBeVisible();
    await ctx.close();
  });

  test("non-admin sees read-only member list", async ({ page, browser }) => {
    await registerUser(page, "ReadOnly Admin");
    await createProjectAndOpen(page, "ReadOnly Test");

    const readerEmail = await registerSecondUser(browser, "ReadOnly User");

    await openMembersPanel(page);
    const panel = page.getByTestId("members-panel");
    await panel.getByPlaceholder("Email address").fill(readerEmail);
    await panel.getByLabel("Role", { exact: true }).selectOption("reader");
    await panel.getByRole("button", { name: "Add" }).click();
    await expect(panel.getByText("ReadOnly User")).toBeVisible();

    // Log in as reader in separate context
    const projectUrl = page.url();
    const ctx = await browser.newContext();
    const readerPage = await ctx.newPage();
    await loginUser(readerPage, readerEmail);
    await readerPage.goto(projectUrl);
    await expect(readerPage).toHaveURL(projectUrl);

    await readerPage.getByRole("button", { name: "Members" }).click();
    const readerPanel = readerPage.getByTestId("members-panel");
    await expect(readerPanel.getByText("ReadOnly Admin")).toBeVisible();

    // Should NOT see admin controls
    await expect(
      readerPanel.getByPlaceholder("Email address"),
    ).not.toBeVisible();
    await expect(
      readerPanel.getByLabel("Remove ReadOnly Admin"),
    ).not.toBeVisible();
    await ctx.close();
  });

  test("non-admin can leave project", async ({ page, browser }) => {
    await registerUser(page, "Leave Admin");
    await createProjectAndOpen(page, "Leave Test");
    const projectUrl = page.url();

    const editorEmail = await registerSecondUser(browser, "Leave User");

    await openMembersPanel(page);
    const panel = page.getByTestId("members-panel");
    await panel.getByPlaceholder("Email address").fill(editorEmail);
    await panel.getByRole("button", { name: "Add" }).click();
    await expect(panel.getByText("Leave User")).toBeVisible();

    // Log in as editor in separate context and leave
    const ctx = await browser.newContext();
    const editorPage = await ctx.newPage();
    await loginUser(editorPage, editorEmail);
    await editorPage.goto(projectUrl);
    await editorPage.getByRole("button", { name: "Members" }).click();
    const leavePanel = editorPage.getByTestId("members-panel");

    await leavePanel.getByRole("button", { name: "Leave Project" }).click();
    const dialog = editorPage.getByRole("dialog", { name: "Leave Project" });
    await expect(
      dialog.getByRole("button", { name: "Leave", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel(/Type/).fill("LEAVE PROJECT");
    await dialog.getByRole("button", { name: "Leave", exact: true }).click();

    // Should navigate to dashboard
    await expect(editorPage).toHaveURL("/");

    // Should not be able to access project anymore
    await editorPage.goto(projectUrl);
    await expect(editorPage.getByText("Project not found")).toBeVisible();
    await ctx.close();
  });

  test("admin can delete project", async ({ page }) => {
    await registerUser(page, "Delete Admin");
    await createProjectAndOpen(page, "Delete Test");

    await openMembersPanel(page);
    const panel = page.getByTestId("members-panel");
    await panel.getByRole("button", { name: "Delete Project" }).click();

    const dialog = page.getByRole("dialog", { name: "Delete Project" });
    await expect(
      dialog.getByRole("button", { name: "Delete", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel(/Type/).fill("DELETE PROJECT");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();

    // Should navigate to dashboard
    await expect(page).toHaveURL("/");
  });

  test("dangerous action confirmation typing validation", async ({ page }) => {
    await registerUser(page, "Confirm Admin");
    await createProjectAndOpen(page, "Confirm Test");

    await openMembersPanel(page);
    const panel = page.getByTestId("members-panel");
    await panel.getByRole("button", { name: "Delete Project" }).click();

    const dialog = page.getByRole("dialog", { name: "Delete Project" });
    const deleteBtn = dialog.getByRole("button", {
      name: "Delete",
      exact: true,
    });

    // Wrong text should keep button disabled
    await dialog.getByLabel(/Type/).fill("delete project");
    await expect(deleteBtn).toBeDisabled();

    await dialog.getByLabel(/Type/).clear();
    await dialog.getByLabel(/Type/).fill("DELETE PROJEC");
    await expect(deleteBtn).toBeDisabled();

    // Correct text enables button
    await dialog.getByLabel(/Type/).clear();
    await dialog.getByLabel(/Type/).fill("DELETE PROJECT");
    await expect(deleteBtn).toBeEnabled();
  });
});
