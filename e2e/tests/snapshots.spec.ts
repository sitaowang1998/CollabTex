import { test, expect } from "@playwright/test";

async function registerUser(
  page: import("@playwright/test").Page,
  name: string,
) {
  const email = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`;
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
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: projectName, exact: true }),
  ).toBeVisible();
  await page.getByRole("heading", { name: projectName, exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/);
}

async function openSnapshotsPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Snapshots" }).click();
  await expect(page.getByTestId("snapshots-panel")).toBeVisible();
}

async function closeSnapshotsPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Close snapshots panel" }).click();
  await expect(page.getByTestId("snapshots-panel")).not.toBeVisible();
}

async function getSnapshotCount(
  page: import("@playwright/test").Page,
): Promise<number> {
  const list = page.getByRole("list", { name: "Project snapshots" });
  const isVisible = await list.isVisible().catch(() => false);
  if (!isVisible) return 0;
  return list.getByRole("listitem").count();
}

/**
 * Polls the snapshot panel until at least `minCount` snapshots appear.
 * Re-opens the panel each poll cycle to refresh the list.
 */
async function waitForSnapshotCount(
  page: import("@playwright/test").Page,
  minCount: number,
  timeout = 60000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (
      await page
        .getByTestId("snapshots-panel")
        .isVisible()
        .catch(() => false)
    ) {
      await closeSnapshotsPanel(page);
    }
    await openSnapshotsPanel(page);
    const count = await getSnapshotCount(page);
    if (count >= minCount) return count;
    await page.waitForTimeout(2000);
  }
  throw new Error(
    `Timed out waiting for at least ${minCount} snapshots (timeout: ${timeout}ms)`,
  );
}

async function typeInEditor(
  page: import("@playwright/test").Page,
  text: string,
) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await page.waitForTimeout(1000);
}

async function compileAndWait(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Compile" }).click();
  await expect(
    page
      .getByTestId("pdf-canvas-container")
      .or(page.getByText("Compile logs:")),
  ).toBeVisible({ timeout: 30000 });
}

async function uploadFile(
  page: import("@playwright/test").Page,
  name: string,
  mimeType: string,
  content: Buffer,
) {
  await page.getByRole("button", { name: "New" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Upload File" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({ name, mimeType, buffer: content });
}

// Minimal valid 1x1 PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Snapshot Panel", () => {
  test("opens panel and shows snapshot list", async ({ page }) => {
    await registerUser(page, "Snap User");
    await createProjectAndOpen(page, "Snap Project");
    await openSnapshotsPanel(page);

    await expect(
      page.getByRole("list", { name: "Project snapshots" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  });

  test("closes panel via close button", async ({ page }) => {
    await registerUser(page, "Snap User 2");
    await createProjectAndOpen(page, "Snap Project 2");
    await openSnapshotsPanel(page);

    await page.getByRole("button", { name: "Close snapshots panel" }).click();
    await expect(page.getByTestId("snapshots-panel")).not.toBeVisible();
  });

  test("closes panel via Escape key", async ({ page }) => {
    await registerUser(page, "Snap User 3");
    await createProjectAndOpen(page, "Snap Project 3");
    await openSnapshotsPanel(page);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("snapshots-panel")).not.toBeVisible();
  });

  test("snapshot appears after compile", async ({ page }) => {
    test.setTimeout(120000);

    await registerUser(page, "Snap Compile User");
    await createProjectAndOpen(page, "Snap Compile Project");

    // Record initial count
    await openSnapshotsPanel(page);
    const initialCount = await getSnapshotCount(page);
    await closeSnapshotsPanel(page);

    // Wait for dedup window to pass since project creation
    await page.waitForTimeout(35000);

    // Type content and compile
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await typeInEditor(
      page,
      "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}",
    );
    await compileAndWait(page);

    // Wait for compile-triggered snapshot
    await waitForSnapshotCount(page, initialCount + 1);
    // Success — a new snapshot appeared after compile
  });

  test("restore round-trip with binary content", async ({ page }) => {
    test.setTimeout(180000);

    await registerUser(page, "Snap Restore User");
    await createProjectAndOpen(page, "Snap Restore Project");

    // Wait for dedup window to pass since project creation
    await page.waitForTimeout(35000);

    // Type LaTeX content (compilable without the image)
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await typeInEditor(
      page,
      "\\documentclass{article}\n\\begin{document}\nOriginal content\n\\end{document}",
    );

    // Upload binary image
    const tree = page.getByTestId("file-tree");
    await uploadFile(page, "logo.png", "image/png", TINY_PNG);
    await expect(tree.getByText("logo.png")).toBeVisible();

    // Compile to create snapshot with original content + image
    await compileAndWait(page);

    // Wait for compile snapshot
    await openSnapshotsPanel(page);
    const countAfterFirstCompile = await waitForSnapshotCount(page, 2);
    await closeSnapshotsPanel(page);

    // Wait 35 seconds to ensure dedup window passes before second compile
    await page.waitForTimeout(35000);

    // Edit main.tex to modified content
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await typeInEditor(
      page,
      "\\documentclass{article}\n\\begin{document}\nModified content\n\\end{document}",
    );

    // Compile again — creates snapshot with modified content
    await compileAndWait(page);

    // Wait for second compile snapshot
    await openSnapshotsPanel(page);
    await waitForSnapshotCount(page, countAfterFirstCompile + 1);

    // Restore the first-compile snapshot (the one with "Original content")
    // Snapshots are newest-first; pick the one that's NOT the latest
    const restoreButtons = page.getByRole("button", { name: "Restore" });
    const restoreCount = await restoreButtons.count();
    await restoreButtons.nth(restoreCount - 2).click();

    // Confirm restore
    await expect(page.getByText("Restore Snapshot")).toBeVisible();
    await page
      .getByRole("dialog", { name: "Confirm restore" })
      .getByRole("button", { name: "Restore" })
      .click();

    // Wait for restore to complete
    await page.waitForTimeout(3000);
    if (
      await page
        .getByTestId("snapshots-panel")
        .isVisible()
        .catch(() => false)
    ) {
      await closeSnapshotsPanel(page);
    }
    await openSnapshotsPanel(page);

    // Verify "Auto-save before restore" and "Restored to" messages
    await expect(page.getByText("Auto-save before restore")).toBeVisible();
    await expect(page.getByText(/^Restored to /)).toBeVisible();

    // Verify no UUIDs in snapshot messages
    const panelText = await page.getByTestId("snapshots-panel").textContent();
    expect(panelText).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );

    // Verify main.tex has restored content
    await closeSnapshotsPanel(page);
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("Original content");

    // Verify logo.png still in file tree
    await expect(tree.getByText("logo.png")).toBeVisible();
  });

  test("undo restore via Auto-save before restore", async ({ page }) => {
    test.setTimeout(180000);

    await registerUser(page, "Snap Undo User");
    await createProjectAndOpen(page, "Snap Undo Project");

    // Wait for dedup window to pass since project creation
    await page.waitForTimeout(35000);

    // Type Version A
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await typeInEditor(
      page,
      "\\documentclass{article}\n\\begin{document}\nVersion A\n\\end{document}",
    );
    await compileAndWait(page);

    // Wait for snapshot
    await openSnapshotsPanel(page);
    await waitForSnapshotCount(page, 2);
    await closeSnapshotsPanel(page);

    // Wait for dedup window
    await page.waitForTimeout(35000);

    // Edit to Version B
    await page.getByText("main.tex").click();
    await typeInEditor(
      page,
      "\\documentclass{article}\n\\begin{document}\nVersion B\n\\end{document}",
    );
    await compileAndWait(page);

    // Wait for Version B snapshot
    await openSnapshotsPanel(page);
    const countBeforeRestore = await waitForSnapshotCount(page, 3);

    // Restore the Version A snapshot (second-to-last)
    const restoreButtons = page.getByRole("button", { name: "Restore" });
    const restoreCount = await restoreButtons.count();
    await restoreButtons.nth(restoreCount - 2).click();
    await page
      .getByRole("dialog", { name: "Confirm restore" })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.waitForTimeout(3000);

    // Verify Version A
    if (
      await page
        .getByTestId("snapshots-panel")
        .isVisible()
        .catch(() => false)
    ) {
      await closeSnapshotsPanel(page);
    }
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-content")).toContainText("Version A");

    // Undo: restore "Auto-save before restore"
    await openSnapshotsPanel(page);
    await waitForSnapshotCount(page, countBeforeRestore + 2);
    const autoSaveItem = page
      .getByRole("listitem")
      .filter({ hasText: "Auto-save before restore" });
    await autoSaveItem.getByRole("button", { name: "Restore" }).click();
    await page
      .getByRole("dialog", { name: "Confirm restore" })
      .getByRole("button", { name: "Restore" })
      .click();
    await page.waitForTimeout(3000);

    // Verify Version B is back
    if (
      await page
        .getByTestId("snapshots-panel")
        .isVisible()
        .catch(() => false)
    ) {
      await closeSnapshotsPanel(page);
    }
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-content")).toContainText("Version B");
  });
});
