import { test, expect } from "@playwright/test";

async function registerUser(
  page: import("@playwright/test").Page,
  name: string,
) {
  const email = `rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  return email;
}

async function registerSecondUser(
  browser: import("@playwright/test").Browser,
  name: string,
) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const email = await registerUser(p, name);
  await ctx.close();
  return email;
}

async function loginUser(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
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
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: projectName, exact: true }),
  ).toBeVisible();
  await page.getByRole("heading", { name: projectName, exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/);
}

async function addMember(
  page: import("@playwright/test").Page,
  email: string,
  memberName: string,
  role?: string,
) {
  await page.getByRole("button", { name: "Members" }).click();
  await expect(page.getByTestId("members-panel")).toBeVisible();
  const panel = page.getByTestId("members-panel");
  await panel.getByPlaceholder("Email address").fill(email);
  await panel.getByRole("button", { name: "Add" }).click();
  await expect(panel.getByText(memberName)).toBeVisible();

  if (role && role !== "editor") {
    await panel.getByLabel(`Role for ${memberName}`).selectOption(role);
    await page
      .getByRole("dialog", { name: "Change Role" })
      .getByRole("button", { name: "Change" })
      .click();
  }

  await page.getByLabel("Close members panel").click();
}

function getProjectUrl(page: import("@playwright/test").Page): string {
  return page.url();
}

test.describe("Realtime Sync", () => {
  test("opening a text file loads content via realtime sync", async ({
    page,
  }) => {
    await registerUser(page, "Realtime User");
    await createProjectAndOpen(page, "Realtime Test");

    // main.tex is auto-created; click it
    await page.getByText("main.tex").click();

    // Wait for editor to sync and render
    await expect(page.getByTestId("editor-container")).toBeVisible();
    await expect(page.locator(".cm-editor")).toBeVisible();
  });

  test("typing in editor persists content", async ({ page }) => {
    await registerUser(page, "Typing User");
    await createProjectAndOpen(page, "Typing Test");

    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    // Type into the editor
    await page.locator(".cm-content").click();
    await page.keyboard.type("\\documentclass{article}");

    // Verify content appears
    await expect(page.locator(".cm-content")).toContainText(
      "\\documentclass{article}",
    );
  });

  test("two users see each other's edits in real time", async ({
    page,
    browser,
  }) => {
    // User A: create project
    await registerUser(page, "User A");
    await createProjectAndOpen(page, "Collab Test");
    const projectUrl = getProjectUrl(page);

    // Add User B as editor
    const userBEmail = await registerSecondUser(browser, "User B");
    await addMember(page, userBEmail, "User B");

    // User A: open main.tex
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    // User B: login and open same project
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginUser(pageB, userBEmail);
    await pageB.goto(projectUrl);
    await expect(pageB.getByText("main.tex")).toBeVisible();
    await pageB.getByText("main.tex").click();
    await expect(pageB.locator(".cm-editor")).toBeVisible();

    // User A types
    await page.locator(".cm-content").click();
    await page.keyboard.type("Hello from A");

    // User B should see it
    await expect(pageB.locator(".cm-content")).toContainText("Hello from A", {
      timeout: 10000,
    });

    // User B types
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.press("End");
    await pageB.keyboard.type(" and B");

    // User A should see it
    await expect(page.locator(".cm-content")).toContainText("and B", {
      timeout: 10000,
    });

    await ctxB.close();
  });

  test("read-only user cannot edit", async ({ page, browser }) => {
    await registerUser(page, "Admin RO");
    await createProjectAndOpen(page, "ReadOnly Test");

    // Add reader
    const readerEmail = await registerSecondUser(browser, "Reader User");
    await addMember(page, readerEmail, "Reader User", "reader");

    // Reader: login and open project
    const projectUrl = getProjectUrl(page);
    const ctxReader = await browser.newContext();
    const readerPage = await ctxReader.newPage();
    await loginUser(readerPage, readerEmail);
    await readerPage.goto(projectUrl);
    await expect(readerPage.getByText("main.tex")).toBeVisible();
    // File tree buttons are disabled for readers (drag disabled), use force click
    await readerPage.getByText("main.tex").click({ force: true });
    await expect(readerPage.locator(".cm-editor")).toBeVisible();

    // Try to type — editor should be read-only
    const contentBefore = await readerPage.locator(".cm-content").textContent();
    await readerPage.locator(".cm-content").click();
    await readerPage.keyboard.type("should not appear");
    const contentAfter = await readerPage.locator(".cm-content").textContent();

    expect(contentAfter).toBe(contentBefore);

    await ctxReader.close();
  });

  test("switching files preserves content on switch-back", async ({ page }) => {
    await registerUser(page, "Switch User");
    await createProjectAndOpen(page, "Switch Test");

    // Create chapter1.tex first
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("menuitem", { name: "New File" }).click();
    await page.getByLabel("File path").fill("chapter1.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(
      page.getByTestId("file-tree").getByText("chapter1.tex"),
    ).toBeVisible();

    // Open main.tex and type content
    await page.getByTestId("file-tree").getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();
    await page.keyboard.type("Main content here");
    await expect(page.locator(".cm-content")).toContainText(
      "Main content here",
    );

    // Wait for server to persist
    await page.waitForTimeout(1000);

    // Switch to chapter1.tex
    await page.getByTestId("file-tree").getByText("chapter1.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await expect(page.locator(".cm-content")).not.toContainText(
      "Main content here",
    );

    // Switch back to main.tex — content should be preserved
    await page.getByTestId("file-tree").getByText("main.tex").click();
    await expect(page.locator(".cm-content")).toContainText(
      "Main content here",
      { timeout: 10000 },
    );
  });

  test("mid-session join shows existing content", async ({ page, browser }) => {
    // User A creates project and types content
    await registerUser(page, "Mid Join Admin");
    await createProjectAndOpen(page, "Mid Join Test");
    const projectUrl = getProjectUrl(page);

    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();
    await page.keyboard.type("Existing content from A");
    await expect(page.locator(".cm-content")).toContainText(
      "Existing content from A",
    );

    // Wait for server to persist
    await page.waitForTimeout(1000);

    // User B joins mid-session
    const userBEmail = await registerSecondUser(browser, "Mid Join Editor");
    await addMember(page, userBEmail, "Mid Join Editor");

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginUser(pageB, userBEmail);
    await pageB.goto(projectUrl);
    await expect(pageB.getByText("main.tex")).toBeVisible();
    await pageB.getByText("main.tex").click();
    await expect(pageB.locator(".cm-editor")).toBeVisible();

    // User B should see User A's content
    await expect(pageB.locator(".cm-content")).toContainText(
      "Existing content from A",
      { timeout: 10000 },
    );

    await ctxB.close();
  });

  test("editing a file updates dashboard timestamp for same user", async ({
    page,
  }) => {
    await registerUser(page, "Timestamp User");
    await createProjectAndOpen(page, "Timestamp Test");

    // Type in main.tex to establish socket connection
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();
    await page.keyboard.type("some edits");

    // Navigate back to dashboard (triggers socket disconnect → touchProjectUpdatedAt)
    await page.getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL("/");

    // Verify the project card shows a recent timestamp
    await expect(page.getByText("just now")).toBeVisible();
  });

  test("editing a file updates dashboard timestamp for another user", async ({
    page,
    browser,
  }) => {
    // User A: create project
    await registerUser(page, "Timestamp Admin");
    await createProjectAndOpen(page, "Timestamp Collab");
    const projectUrl = getProjectUrl(page);

    // Add User B
    const userBEmail = await registerSecondUser(browser, "Timestamp Editor");
    await addMember(page, userBEmail, "Timestamp Editor");

    // Navigate A back to dashboard
    await page.getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL("/");

    // User B: login, open project, edit, leave
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginUser(pageB, userBEmail);
    await pageB.goto(projectUrl);
    await expect(pageB.getByText("main.tex")).toBeVisible();
    await pageB.getByText("main.tex").click();
    await expect(pageB.locator(".cm-editor")).toBeVisible();
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.type("edit by B");

    // User B navigates away (triggers disconnect → touchProjectUpdatedAt)
    await pageB.getByRole("link", { name: "Projects" }).click();
    await expect(pageB).toHaveURL("/");
    await ctxB.close();

    // User A: reload dashboard to see updated timestamp
    await page.reload();
    await expect(page.getByText("Timestamp Collab")).toBeVisible();
    await expect(page.getByText("just now")).toBeVisible();
  });

  test("remote cursor disappears when user leaves", async ({
    page,
    browser,
  }) => {
    // User A: create project
    await registerUser(page, "Cursor Admin");
    await createProjectAndOpen(page, "Cursor Cleanup Test");
    const projectUrl = getProjectUrl(page);

    // Add User B
    const userBEmail = await registerSecondUser(browser, "Cursor Editor");
    await addMember(page, userBEmail, "Cursor Editor");

    // User A: open main.tex
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();

    // User B: login, open same file, type (creates cursor visible to A)
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginUser(pageB, userBEmail);
    await pageB.goto(projectUrl);
    await expect(pageB.getByText("main.tex")).toBeVisible();
    await pageB.getByText("main.tex").click();
    await expect(pageB.locator(".cm-editor")).toBeVisible();
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.type("hello from B");

    // User A should see User B's cursor
    await expect(page.locator(".cm-ySelectionCaret")).toBeVisible({
      timeout: 5000,
    });

    // User B leaves (navigates away → triggers awareness removal)
    await pageB.getByRole("link", { name: "Projects" }).click();
    await expect(pageB).toHaveURL("/");

    // User A should see the cursor disappear
    await expect(page.locator(".cm-ySelectionCaret")).not.toBeVisible({
      timeout: 5000,
    });

    await ctxB.close();
  });

  test("remote cursor disappears when user closes browser tab", async ({
    page,
    browser,
  }) => {
    await registerUser(page, "TabClose Admin");
    await createProjectAndOpen(page, "TabClose Cursor Test");
    const projectUrl = getProjectUrl(page);

    const userBEmail = await registerSecondUser(browser, "TabClose Editor");
    await addMember(page, userBEmail, "TabClose Editor");

    // User A opens main.tex
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();

    // User B opens same file and types (creates cursor visible to A)
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginUser(pageB, userBEmail);
    await pageB.goto(projectUrl);
    await pageB.getByText("main.tex").click();
    await expect(pageB.locator(".cm-editor")).toBeVisible();
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.type("tab close test");

    // User A should see User B's cursor
    await expect(page.locator(".cm-ySelectionCaret")).toBeVisible({
      timeout: 5000,
    });

    // Simulate tab close — close the browser context entirely (no clean unmount)
    await ctxB.close();

    // User A should see B's cursor disappear (server broadcasts removal)
    await expect(page.locator(".cm-ySelectionCaret")).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("cursor label shows actual user name", async ({ page, browser }) => {
    await registerUser(page, "Label Admin");
    await createProjectAndOpen(page, "Cursor Label Test");
    const projectUrl = getProjectUrl(page);

    const userBEmail = await registerSecondUser(browser, "Bob Smith");
    await addMember(page, userBEmail, "Bob Smith");

    // User A opens main.tex
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();

    // User B opens same file and types
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginUser(pageB, userBEmail);
    await pageB.goto(projectUrl);
    await pageB.getByText("main.tex").click();
    await expect(pageB.locator(".cm-editor")).toBeVisible();
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.type("typed by Bob");

    // User A should see a cursor label with Bob's name
    await expect(page.locator(".cm-ySelectionInfo")).toContainText(
      "Bob Smith",
      { timeout: 5000 },
    );

    await ctxB.close();
  });

  test("commenter sees editor changes in real time", async ({
    page,
    browser,
  }) => {
    await registerUser(page, "Commenter Admin");
    await createProjectAndOpen(page, "Commenter Live Test");
    const projectUrl = getProjectUrl(page);

    const commenterEmail = await registerSecondUser(browser, "Commenter User");
    await addMember(page, commenterEmail, "Commenter User", "commenter");

    // Admin opens main.tex and types
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();
    await page.keyboard.type("Admin wrote this");

    // Commenter opens same file
    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await loginUser(pageC, commenterEmail);
    await pageC.goto(projectUrl);
    await pageC.getByText("main.tex").click({ force: true });
    await expect(pageC.locator(".cm-editor")).toBeVisible();

    // Commenter should see admin's content
    await expect(pageC.locator(".cm-content")).toContainText(
      "Admin wrote this",
      { timeout: 10000 },
    );

    // Admin types more — commenter should see it live
    await page.locator(".cm-content").click();
    await page.keyboard.type(" and more");

    await expect(pageC.locator(".cm-content")).toContainText("and more", {
      timeout: 5000,
    });

    await ctxC.close();
  });

  test("remote cursor disappears when user switches to different file", async ({
    page,
    browser,
  }) => {
    await registerUser(page, "Switch Cursor Admin");
    await createProjectAndOpen(page, "Switch Cursor Test");
    const projectUrl = getProjectUrl(page);

    // Create a second file
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("menuitem", { name: "New File" }).click();
    await page.getByLabel("File path").fill("chapter1.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(
      page.getByTestId("file-tree").getByText("chapter1.tex"),
    ).toBeVisible();

    // Add User B
    const userBEmail = await registerSecondUser(browser, "Switch Cursor B");
    await addMember(page, userBEmail, "Switch Cursor B");

    // User A opens main.tex
    await page.getByTestId("file-tree").getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();

    // User B opens same file and types
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginUser(pageB, userBEmail);
    await pageB.goto(projectUrl);
    await pageB.getByText("main.tex").click();
    await expect(pageB.locator(".cm-editor")).toBeVisible();
    await pageB.locator(".cm-content").click();
    await pageB.keyboard.type("B typing");

    // User A should see User B's cursor
    await expect(page.locator(".cm-ySelectionCaret")).toBeVisible({
      timeout: 5000,
    });

    // User B switches to chapter1.tex (triggers awareness removal for main.tex)
    await pageB.getByTestId("file-tree").getByText("chapter1.tex").click();
    await expect(pageB.locator(".cm-editor")).toBeVisible();

    // User A should see B's cursor disappear from main.tex
    await expect(page.locator(".cm-ySelectionCaret")).not.toBeVisible({
      timeout: 5000,
    });

    await ctxB.close();
  });

  test("navigating away and back preserves content", async ({ page }) => {
    await registerUser(page, "Nav User");
    await createProjectAndOpen(page, "Nav Test");
    const projectUrl = getProjectUrl(page);

    // Open main.tex and type
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();
    await page.keyboard.type("persistent content");
    await expect(page.locator(".cm-content")).toContainText(
      "persistent content",
    );

    // Navigate to dashboard
    await page.getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL("/");

    // Navigate back to project
    await page.goto(projectUrl);
    await expect(page.getByText("main.tex")).toBeVisible();
    await page.getByText("main.tex").click();

    // Content should still be there
    await expect(page.locator(".cm-content")).toContainText(
      "persistent content",
      { timeout: 10000 },
    );
  });
});
