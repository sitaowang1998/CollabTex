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
 * Optionally re-triggers compilation every `recompileIntervalMs` to handle
 * the server-side dedup window (compiles within 30s of the last snapshot
 * are silently skipped, so we retry until one succeeds).
 */
async function waitForSnapshotCount(
  page: import("@playwright/test").Page,
  minCount: number,
  {
    timeout = 90000,
    recompileIntervalMs = 15000,
  }: { timeout?: number; recompileIntervalMs?: number } = {},
) {
  const deadline = Date.now() + timeout;
  let lastCompileTime = 0;
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

    // Re-trigger compilation periodically to overcome the dedup window
    if (Date.now() - lastCompileTime > recompileIntervalMs) {
      await closeSnapshotsPanel(page);
      await compileAndWait(page);
      lastCompileTime = Date.now();
      await openSnapshotsPanel(page);
      const countAfterCompile = await getSnapshotCount(page);
      if (countAfterCompile >= minCount) return countAfterCompile;
    }

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

  test("restore refreshes file tree when files change", async ({ page }) => {
    test.setTimeout(180000);

    await registerUser(page, "Tree Restore User");
    await createProjectAndOpen(page, "Tree Restore Project");

    // Type compilable content and compile → snapshot A (only main.tex)
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await typeInEditor(
      page,
      "\\documentclass{article}\n\\begin{document}\nOriginal\n\\end{document}",
    );
    await compileAndWait(page);

    await openSnapshotsPanel(page);
    const countA = await waitForSnapshotCount(page, 2);
    await closeSnapshotsPanel(page);

    // Create a new file chapter1.tex
    const tree = page.getByTestId("file-tree");
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("menuitem", { name: "New File" }).click();
    await page.getByLabel("File path").fill("chapter1.tex");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(tree.getByText("chapter1.tex")).toBeVisible();

    // Compile → snapshot B (main.tex + chapter1.tex)
    await compileAndWait(page);

    await openSnapshotsPanel(page);
    await waitForSnapshotCount(page, countA + 1);

    // Restore to snapshot A (before chapter1.tex was created)
    const restoreButtons = page.getByRole("button", { name: "Restore" });
    const restoreCount = await restoreButtons.count();
    await restoreButtons.nth(restoreCount - 2).click();

    await page
      .getByRole("dialog", { name: "Confirm restore" })
      .getByRole("button", { name: "Restore" })
      .click();

    await page.waitForTimeout(3000);

    // Close snapshots panel if open
    if (
      await page
        .getByTestId("snapshots-panel")
        .isVisible()
        .catch(() => false)
    ) {
      await closeSnapshotsPanel(page);
    }

    // chapter1.tex should be gone from the file tree
    await expect(tree.getByText("chapter1.tex")).not.toBeVisible({
      timeout: 10000,
    });

    // main.tex should still be present with original content
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-content")).toContainText("Original");
  });

  test("restore resets comment threads", async ({ page }) => {
    test.setTimeout(180000);

    await registerUser(page, "Comment Restore User");
    await createProjectAndOpen(page, "Comment Restore Project");

    // Type compilable content and compile → snapshot A (no comments)
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await typeInEditor(
      page,
      "\\documentclass{article}\n\\begin{document}\nHello world\n\\end{document}",
    );
    await compileAndWait(page);

    await openSnapshotsPanel(page);
    const countA = await waitForSnapshotCount(page, 2);
    await closeSnapshotsPanel(page);

    // Create a comment thread on "Hello"
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    // Select text and add comment
    await page.locator(".cm-content").click();
    await page.evaluate(
      ({ searchText }) => {
        const content = document.querySelector(".cm-content");
        if (!content) throw new Error("No .cm-content element");

        function findTextNode(
          node: Node,
        ): { node: Text; offset: number } | null {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent ?? "";
            const idx = text.indexOf(searchText);
            if (idx !== -1) return { node: node as Text, offset: idx };
          }
          for (const child of node.childNodes) {
            const result = findTextNode(child);
            if (result) return result;
          }
          return null;
        }

        const found = findTextNode(content);
        if (!found) throw new Error(`Text "${searchText}" not found in editor`);

        const range = document.createRange();
        range.setStart(found.node, found.offset);
        range.setEnd(found.node, found.offset + searchText.length);

        const selection = window.getSelection();
        if (!selection) throw new Error("No window selection");
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      },
      { searchText: "Hello" },
    );
    await page.waitForTimeout(300);

    await expect(page.getByTestId("add-comment-btn")).toBeVisible();
    await page.getByTestId("add-comment-btn").click();
    await expect(page.getByTestId("create-comment-form")).toBeVisible();
    await page.getByLabel("Comment body").fill("Test comment on Hello");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByTestId("comment-thread").first()).toBeVisible();

    // Compile → snapshot B (has comment)
    await compileAndWait(page);
    await openSnapshotsPanel(page);
    await waitForSnapshotCount(page, countA + 1);

    // Restore to snapshot A (no comments)
    const restoreButtons = page.getByRole("button", { name: "Restore" });
    const restoreCount = await restoreButtons.count();
    await restoreButtons.nth(restoreCount - 2).click();

    await page
      .getByRole("dialog", { name: "Confirm restore" })
      .getByRole("button", { name: "Restore" })
      .click();

    await page.waitForTimeout(3000);

    // Close snapshots panel if open
    if (
      await page
        .getByTestId("snapshots-panel")
        .isVisible()
        .catch(() => false)
    ) {
      await closeSnapshotsPanel(page);
    }

    // Click on main.tex to ensure comments are loaded for it
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    // Comment thread should be gone
    await expect(page.getByTestId("comment-thread")).not.toBeVisible({
      timeout: 10000,
    });
  });
});
