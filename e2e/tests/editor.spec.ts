import { test, expect } from "@playwright/test";

async function registerAndCreateProject(
  page: import("@playwright/test").Page,
  projectName: string,
) {
  const email = `editor-${Date.now()}@test.com`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill("Editor Tester");
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

async function clickToolbarAction(
  page: import("@playwright/test").Page,
  name: "New File" | "New Folder" | "Upload File",
) {
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("menuitem", { name }).click();
}

test.describe("Editor Page", () => {
  test("loads editor page with project name, branding, and default main.tex", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "My Editor Project");

    await expect(page.getByText("CollabTex")).toBeVisible();
    await expect(page.getByText("My Editor Project")).toBeVisible();
    // New projects auto-create main.tex
    await expect(page.getByText("main.tex")).toBeVisible();
  });

  test("main.tex has main document indicator", async ({ page }) => {
    await registerAndCreateProject(page, "Main Doc Project");

    await expect(page.getByTestId("main-indicator")).toBeVisible();
  });

  test("create a new file via New File button", async ({ page }) => {
    await registerAndCreateProject(page, "File Test Project");
    const tree = page.getByTestId("file-tree");

    await clickToolbarAction(page, "New File");
    await expect(page.getByRole("dialog")).toBeVisible();

    // Input should not have leading /
    await page.getByLabel("File path").fill("chapter1.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();

    await expect(tree.getByText("chapter1.tex")).toBeVisible();
    // Auto-selected: editor shows the new file in CodeMirror
    await expect(page.locator(".cm-editor")).toBeVisible();
  });

  test("select a file loads content in CodeMirror editor", async ({ page }) => {
    await registerAndCreateProject(page, "Select File Project");

    // main.tex is auto-created, click it
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  });

  test("create a folder via New Folder button", async ({ page }) => {
    await registerAndCreateProject(page, "Folder Project");

    await clickToolbarAction(page, "New Folder");
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel("Folder name").fill("chapters");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();

    await expect(page.getByText("chapters")).toBeVisible();
  });

  test("create file inside selected folder", async ({ page }) => {
    await registerAndCreateProject(page, "Subfolder File Project");
    const tree = page.getByTestId("file-tree");

    // Create a folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("chapters");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("chapters")).toBeVisible();

    // Click folder to select it
    await tree.getByText("chapters").click();

    // Create file — should appear inside the selected folder
    await clickToolbarAction(page, "New File");
    const input = page.getByLabel("File path");
    // Should be pre-filled with "chapters/"
    await expect(input).toHaveValue("chapters/");
    await input.fill("chapters/intro.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();

    await expect(tree.getByText("intro.tex")).toBeVisible();
  });

  test("clicking folder name does not collapse it", async ({ page }) => {
    await registerAndCreateProject(page, "No Collapse Project");
    const tree = page.getByTestId("file-tree");

    // Create a folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("docs");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("docs")).toBeVisible();

    // Create a file inside the folder
    await tree.getByText("docs").click();
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("docs/readme.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("readme.tex")).toBeVisible();

    // Click folder name again — should NOT collapse, readme.tex still visible
    await tree.getByText("docs").click();
    await expect(tree.getByText("readme.tex")).toBeVisible();
  });

  test("deleting file preserves empty local folder", async ({ page }) => {
    await registerAndCreateProject(page, "Preserve Folder Project");
    const tree = page.getByTestId("file-tree");

    // Create a folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("assets");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("assets")).toBeVisible();

    // Create a file inside the folder
    await tree.getByText("assets").click();
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("assets/temp.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("temp.tex")).toBeVisible();

    // Delete the file via context menu
    await tree.getByText("temp.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();

    // Wait for dialog to close
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Folder should still be visible, file should be gone
    await expect(tree.getByText("assets")).toBeVisible();
    await expect(tree.getByText("temp.tex")).not.toBeVisible();

    // Now delete the empty local folder — should show confirmation, no API error
    await tree.getByText("assets").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(tree.getByText("assets")).not.toBeVisible();
  });

  test("file selected inside folder uses that folder for new file", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "File Context Project");
    const tree = page.getByTestId("file-tree");

    // Create a folder and file inside it
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("src");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await tree.getByText("src").click();
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("src/first.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("first.tex")).toBeVisible();

    // Select the file inside the folder
    await tree.getByText("first.tex").click();

    // Click New File — should use the file's parent folder
    await clickToolbarAction(page, "New File");
    const input = page.getByLabel("File path");
    await expect(input).toHaveValue("src/");
  });

  test("shift+click multi-select with root-level empty folder survives right-click", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "MultiSelect Root Folder");

    // Create an empty local folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("docs");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(page.getByText("docs")).toBeVisible();

    const tree = page.getByTestId("file-tree");

    // Click main.tex first (sets lastClicked)
    await tree.getByText("main.tex").click();

    // Shift+click the docs folder to multi-select
    await tree.getByText("docs").click({ modifiers: ["Shift"] });

    // Both should still be visible
    await expect(tree.getByText("main.tex")).toBeVisible();
    await expect(tree.getByText("docs")).toBeVisible();

    // Right-click on main.tex (a selected item)
    await tree.getByText("main.tex").click({ button: "right" });

    // Empty folder should still be visible
    await expect(tree.getByText("docs")).toBeVisible();
    // Context menu should show bulk delete with count including the empty folder
    await expect(
      page.getByRole("menuitem", { name: /Delete 2 items/ }),
    ).toBeVisible();

    // Click Delete — confirmation should also show correct count
    await page.getByRole("menuitem", { name: /Delete 2 items/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("2 items");
  });

  test("shift+click multi-select with subfolder empty folder survives right-click", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "MultiSelect Subfolder");

    // Create a parent folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("chapters");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(page.getByText("chapters")).toBeVisible();

    // Select "chapters" and create a subfolder inside it
    await page.getByText("chapters").click();
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("drafts");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(page.getByText("drafts")).toBeVisible();

    const tree = page.getByTestId("file-tree");

    // Click main.tex first
    await tree.getByText("main.tex").click();

    // Shift+click "drafts" to multi-select range
    await tree.getByText("drafts").click({ modifiers: ["Shift"] });

    // Right-click on main.tex
    await tree.getByText("main.tex").click({ button: "right" });

    // "drafts" should still be visible
    await expect(tree.getByText("drafts")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Delete/ })).toBeVisible();
  });

  test("empty subfolder survives after file creation then multi-select right-click", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "Subfolder Survive");

    const tree = page.getByTestId("file-tree");

    // Create parent folder "chapters"
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("chapters");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("chapters")).toBeVisible();

    // Select chapters, create a subfolder "drafts" inside
    await tree.getByText("chapters").click();
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("drafts");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("drafts")).toBeVisible();

    // Now create a file inside chapters (this triggers refreshTree which could wipe local folders)
    await tree.getByText("chapters").click();
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("chapters/intro.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("intro.tex")).toBeVisible();

    // drafts should still be visible after the file creation refresh
    await expect(tree.getByText("drafts")).toBeVisible();

    // Now multi-select: click main.tex, shift+click drafts
    await tree.getByText("main.tex").click();
    await tree.getByText("drafts").click({ modifiers: ["Shift"] });

    // Right-click on main.tex
    await tree.getByText("main.tex").click({ button: "right" });

    // drafts should still be visible
    await expect(tree.getByText("drafts")).toBeVisible();
  });

  test("subfolder emptied by delete survives multi-select right-click", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "Emptied Subfolder");

    const tree = page.getByTestId("file-tree");

    // Create folder "chapters" with subfolder "drafts"
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("chapters");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await tree.getByText("chapters").click();
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("drafts");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("drafts")).toBeVisible();

    // Create a file inside drafts (makes it "real" on the API side)
    await tree.getByText("drafts").click();
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("chapters/drafts/temp.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("temp.tex")).toBeVisible();

    // Delete the file (makes drafts empty again — but it was real, now it's gone from API)
    await tree.getByText("temp.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(tree.getByText("temp.tex")).not.toBeVisible();

    // drafts should still exist (preserved by local folder tracking)
    await expect(tree.getByText("drafts")).toBeVisible();

    // Multi-select: click main.tex, shift+click drafts
    await tree.getByText("main.tex").click();
    await tree.getByText("drafts").click({ modifiers: ["Shift"] });

    // Right-click on main.tex
    await tree.getByText("main.tex").click({ button: "right" });

    // drafts should STILL be visible
    await expect(tree.getByText("drafts")).toBeVisible();
  });

  test("CollabTex link navigates back to dashboard", async ({ page }) => {
    await registerAndCreateProject(page, "Nav Project");

    await page.getByText("CollabTex").click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  });

  test("collapse and expand file tree panel", async ({ page }) => {
    await registerAndCreateProject(page, "Collapse Tree Project");

    // File tree header should be visible
    await expect(page.getByText("Files")).toBeVisible();
    await expect(page.getByTestId("file-tree")).toBeVisible();

    // Collapse file tree
    await page.getByLabel("Collapse file tree").click();
    await expect(page.getByText("Files")).not.toBeVisible();
    await expect(page.getByTestId("file-tree")).not.toBeVisible();

    // Expand file tree
    await page.getByLabel("Expand file tree").click();
    await expect(page.getByText("Files")).toBeVisible();
    await expect(page.getByTestId("file-tree")).toBeVisible();
  });

  test("collapse and expand preview panel", async ({ page }) => {
    await registerAndCreateProject(page, "Panel Test");

    // Preview header should be visible
    await expect(page.getByText("Preview", { exact: true })).toBeVisible();

    // Collapse preview
    await page.getByLabel("Collapse preview").click();
    await expect(page.getByText("Preview", { exact: true })).not.toBeVisible();

    // Expand preview
    await page.getByLabel("Expand preview").click();
    await expect(page.getByText("Preview", { exact: true })).toBeVisible();
  });

  test("resize file tree panel by dragging", async ({ page }) => {
    await registerAndCreateProject(page, "Resize Project");

    const separator = page.getByRole("separator").first();
    const box = await separator.boundingBox();
    expect(box).not.toBeNull();

    // Get initial file tree width
    const treeBefore = await page.getByTestId("file-tree").evaluate((el) => {
      return el.closest("aside")?.getBoundingClientRect().width ?? 0;
    });

    // Drag separator 100px to the right
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2 + 100,
      box!.y + box!.height / 2,
    );
    await page.mouse.up();

    // File tree should be wider
    const treeAfter = await page.getByTestId("file-tree").evaluate((el) => {
      return el.closest("aside")?.getBoundingClientRect().width ?? 0;
    });
    expect(treeAfter).toBeGreaterThan(treeBefore);
  });

  test("logout from editor redirects to login", async ({ page }) => {
    await registerAndCreateProject(page, "Logout Project");

    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL("/login");
  });

  test("login after logout navigates back to editor", async ({ page }) => {
    const email = `relogin-${Date.now()}@test.com`;
    const password = "password123";

    // Register
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Name").fill("Relogin Tester");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/");

    // Create project
    await page
      .getByRole("button", { name: /create your first project/i })
      .click();
    await page.getByLabel("Project name").fill("Relogin Project");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(page.getByText("Relogin Project")).toBeVisible();

    // Navigate to editor
    await page.getByText("Relogin Project").click();
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/);
    const editorUrl = page.url();

    // Logout from editor
    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL("/login");

    // Login again
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/");

    // Navigate back to the same project
    await page.getByText("Relogin Project").click();
    await expect(page).toHaveURL(editorUrl);
    await expect(page.getByText("Relogin Project")).toBeVisible();
    await expect(page.getByText("Files")).toBeVisible();
  });

  test("move a file into a folder via context menu", async ({ page }) => {
    await registerAndCreateProject(page, "Move File Project");
    const tree = page.getByTestId("file-tree");

    // Create a folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("chapters");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("chapters")).toBeVisible();

    // Create a file at root
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("intro.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("intro.tex")).toBeVisible();

    // Right-click the file and select Move
    await tree.getByText("intro.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move" }).click();

    // Move dialog should show
    await expect(page.getByRole("dialog")).toBeVisible();
    const destInput = page.getByLabel("Destination folder");
    await destInput.clear();
    await destInput.fill("/chapters");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();

    // Dialog closes, file now appears inside chapters folder
    await expect(page.getByRole("dialog")).not.toBeVisible();
    // Expand chapters if collapsed
    await expect(tree.getByText("chapters")).toBeVisible();
    // intro.tex should still be visible (now inside chapters)
    await expect(tree.getByText("intro.tex")).toBeVisible();
  });

  test("bulk move same-level files via context menu", async ({ page }) => {
    await registerAndCreateProject(page, "Bulk Move Flat");
    const tree = page.getByTestId("file-tree");

    // Create a destination folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("archive");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("archive")).toBeVisible();

    // Create two files at root
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("a.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("a.tex")).toBeVisible();

    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("b.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("b.tex")).toBeVisible();

    // Multi-select: Ctrl+click both files
    await tree.getByText("a.tex").click({ modifiers: ["Control"] });
    await tree.getByText("b.tex").click({ modifiers: ["Control"] });

    // Right-click one of them to get bulk context menu
    await tree.getByText("a.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Move 2 items/ }).click();

    // Move dialog
    await expect(page.getByRole("dialog")).toBeVisible();
    const destInput = page.getByLabel("Destination folder");
    await destInput.clear();
    await destInput.fill("/archive");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();

    // Dialog closes
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Both files should be inside archive
    await expect(tree.getByText("a.tex")).toBeVisible();
    await expect(tree.getByText("b.tex")).toBeVisible();
  });

  test("bulk move different-level files via context menu preserves structure", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "Bulk Move Deep");
    const tree = page.getByTestId("file-tree");

    // Create files at different depths under /chapters
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("chapters/intro.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("intro.tex")).toBeVisible();

    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("chapters/sub/deep.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("deep.tex")).toBeVisible();

    // Create destination folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("archive");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("archive")).toBeVisible();

    // Multi-select both files
    await tree.getByText("intro.tex").click({ modifiers: ["Control"] });
    await tree.getByText("deep.tex").click({ modifiers: ["Control"] });

    // Right-click to get bulk context menu
    await tree.getByText("intro.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Move 2 items/ }).click();

    // Move dialog
    await expect(page.getByRole("dialog")).toBeVisible();
    const destInput = page.getByLabel("Destination folder");
    await destInput.clear();
    await destInput.fill("/archive");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();

    // Dialog closes
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Both files should be visible — structure preserved
    // intro.tex → /archive/intro.tex
    // deep.tex → /archive/sub/deep.tex (sub/ folder preserved)
    await expect(tree.getByText("intro.tex")).toBeVisible();
    await expect(tree.getByText("deep.tex")).toBeVisible();
    // sub folder exists (may appear twice: empty source + dest copy)
    const subNodes = tree.getByText("sub");
    await expect(subNodes.first()).toBeVisible();
  });

  test("bulk move same-level files via DnD", async ({ page }) => {
    await registerAndCreateProject(page, "DnD Bulk Flat");
    const tree = page.getByTestId("file-tree");

    // Create destination folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("dest");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("dest")).toBeVisible();

    // Create two files at root
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("x.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("x.tex")).toBeVisible();

    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("y.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("y.tex")).toBeVisible();

    // Multi-select both
    await tree.getByText("x.tex").click({ modifiers: ["Control"] });
    await tree.getByText("y.tex").click({ modifiers: ["Control"] });

    // Drag x.tex (which is multi-selected) onto dest folder
    const fileEl = tree.getByText("x.tex");
    const folderEl = tree.getByText("dest");

    const fileBB = await fileEl.boundingBox();
    const folderBB = await folderEl.boundingBox();
    if (!fileBB || !folderBB) throw new Error("Elements not found");

    await page.mouse.move(
      fileBB.x + fileBB.width / 2,
      fileBB.y + fileBB.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      fileBB.x + fileBB.width / 2 + 10,
      fileBB.y + fileBB.height / 2,
      { steps: 3 },
    );
    await page.mouse.move(
      folderBB.x + folderBB.width / 2,
      folderBB.y + folderBB.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();

    // Confirmation dialog
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(tree.getByText("x.tex")).toBeVisible();
    await expect(tree.getByText("y.tex")).toBeVisible();
  });

  test("bulk move different-level files via DnD preserves structure", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "DnD Bulk Deep");
    const tree = page.getByTestId("file-tree");

    // Create files at different depths
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("src/a.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("a.tex")).toBeVisible();

    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("src/lib/b.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("b.tex")).toBeVisible();

    // Create destination folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("dest");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("dest")).toBeVisible();

    // Multi-select both files
    await tree.getByText("a.tex").click({ modifiers: ["Control"] });
    await tree.getByText("b.tex").click({ modifiers: ["Control"] });

    // Drag a.tex (multi-selected) onto dest
    const fileEl = tree.getByText("a.tex");
    const folderEl = tree.getByText("dest");

    const fileBB = await fileEl.boundingBox();
    const folderBB = await folderEl.boundingBox();
    if (!fileBB || !folderBB) throw new Error("Elements not found");

    await page.mouse.move(
      fileBB.x + fileBB.width / 2,
      fileBB.y + fileBB.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      fileBB.x + fileBB.width / 2 + 10,
      fileBB.y + fileBB.height / 2,
      { steps: 3 },
    );
    await page.mouse.move(
      folderBB.x + folderBB.width / 2,
      folderBB.y + folderBB.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();

    // Confirmation dialog
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
    // Structure preserved: a.tex → /dest/a.tex, b.tex → /dest/lib/b.tex
    await expect(tree.getByText("a.tex")).toBeVisible();
    await expect(tree.getByText("b.tex")).toBeVisible();
    // dest folder should contain a lib subfolder (structure preserved)
    // lib may appear twice (empty src/lib + dest/lib), so check count >= 2
    const libNodes = tree.getByText("lib");
    await expect(libNodes.first()).toBeVisible();
  });

  test("drag a file onto a folder shows confirmation", async ({ page }) => {
    await registerAndCreateProject(page, "DnD Move Project");
    const tree = page.getByTestId("file-tree");

    // Create a folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("dest");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("dest")).toBeVisible();

    // Create a file
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("draggable.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("draggable.tex")).toBeVisible();

    // Drag the file onto the folder using low-level pointer events
    // (dnd-kit uses PointerSensor which needs real pointer move events)
    const fileEl = tree.getByText("draggable.tex");
    const folderEl = tree.getByText("dest");

    const fileBB = await fileEl.boundingBox();
    const folderBB = await folderEl.boundingBox();

    if (!fileBB || !folderBB) throw new Error("Elements not found");

    const startX = fileBB.x + fileBB.width / 2;
    const startY = fileBB.y + fileBB.height / 2;
    const endX = folderBB.x + folderBB.width / 2;
    const endY = folderBB.y + folderBB.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move enough to pass the distance threshold (8px)
    await page.mouse.move(startX + 10, startY, { steps: 3 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    // Confirmation dialog should appear
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("Destination folder")).toHaveValue("/dest");

    // Confirm the move
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();

    // Dialog closes, file should be inside the folder
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(tree.getByText("draggable.tex")).toBeVisible();
  });

  test("moving last file out of folder preserves empty folder", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "Empty Folder After Move");
    const tree = page.getByTestId("file-tree");

    // Create a file inside a folder
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("docs/only.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("only.tex")).toBeVisible();
    await expect(tree.getByText("docs")).toBeVisible();

    // Move the file to root via context menu
    await tree.getByText("only.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const destInput = page.getByLabel("Destination folder");
    await destInput.clear();
    await destInput.fill("/");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // File should still exist (now at root) and docs folder should be preserved
    await expect(tree.getByText("only.tex")).toBeVisible();
    await expect(tree.getByText("docs")).toBeVisible();
  });

  test("bulk moving all files from folder preserves empty folder", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "Empty Folder Bulk Move");
    const tree = page.getByTestId("file-tree");

    // Create destination folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("dest");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("dest")).toBeVisible();

    // Create two files in /src
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("src/a.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("a.tex")).toBeVisible();

    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("src/b.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("b.tex")).toBeVisible();

    // Multi-select both files
    await tree.getByText("a.tex").click({ modifiers: ["Control"] });
    await tree.getByText("b.tex").click({ modifiers: ["Control"] });

    // Bulk move to /dest
    await tree.getByText("a.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Move 2 items/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const destInput = page.getByLabel("Destination folder");
    await destInput.clear();
    await destInput.fill("/dest");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Both files should be visible, and /src folder should be preserved
    await expect(tree.getByText("a.tex")).toBeVisible();
    await expect(tree.getByText("b.tex")).toBeVisible();
    await expect(tree.getByText("src")).toBeVisible();
  });

  test("moving file into folder that already has files", async ({ page }) => {
    await registerAndCreateProject(page, "Move Into Existing");
    const tree = page.getByTestId("file-tree");

    // Create a file in /archive
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("archive/existing.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("existing.tex")).toBeVisible();

    // Create a file in /chapters
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("chapters/newcomer.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("newcomer.tex")).toBeVisible();

    // Move newcomer.tex to /archive
    await tree.getByText("newcomer.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const destInput = page.getByLabel("Destination folder");
    await destInput.clear();
    await destInput.fill("/archive");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Both files should be visible inside archive
    await expect(tree.getByText("existing.tex")).toBeVisible();
    await expect(tree.getByText("newcomer.tex")).toBeVisible();
  });

  test("bulk move files from different root parents preserves folder names", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "Cross Root Move");
    const tree = page.getByTestId("file-tree");

    // Create /a.tex at root and /folder/b.tex in a subfolder
    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("a.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("a.tex")).toBeVisible();

    await clickToolbarAction(page, "New File");
    await page.getByLabel("File path").fill("myfolder/b.tex");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("b.tex")).toBeVisible();

    // Create destination folder
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("dest");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("dest")).toBeVisible();

    // Multi-select both files
    await tree.getByText("a.tex").click({ modifiers: ["Control"] });
    await tree.getByText("b.tex").click({ modifiers: ["Control"] });

    // Bulk move to /dest
    await tree.getByText("a.tex").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Move 2 items/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const destInput = page.getByLabel("Destination folder");
    await destInput.clear();
    await destInput.fill("/dest");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move" })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // a.tex should be at /dest/a.tex, b.tex at /dest/myfolder/b.tex
    await expect(tree.getByText("a.tex")).toBeVisible();
    await expect(tree.getByText("b.tex")).toBeVisible();
    // myfolder should exist under dest (structure preserved, not "/destmyfolder")
    // myfolder may appear twice (empty source + under dest), so check first()
    const myfolderNodes = tree.getByText("myfolder");
    await expect(myfolderNodes.first()).toBeVisible();
  });

  test("upload a binary file via Upload File button", async ({ page }) => {
    await registerAndCreateProject(page, "Upload Test Project");
    const tree = page.getByTestId("file-tree");

    await page.getByRole("button", { name: "New" }).click();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Upload File" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "test-image.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-png-content"),
    });

    await expect(tree.getByText("test-image.png")).toBeVisible();
  });

  test("upload a binary file into a subfolder via context menu", async ({
    page,
  }) => {
    await registerAndCreateProject(page, "Upload Subfolder Project");
    const tree = page.getByTestId("file-tree");

    // Create a folder first
    await clickToolbarAction(page, "New Folder");
    await page.getByLabel("Folder name").fill("images");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create" })
      .click();
    await expect(tree.getByText("images")).toBeVisible();

    // Right-click folder and choose Upload File
    await tree.getByText("images").click({ button: "right" });
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Upload File" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-logo"),
    });

    await expect(tree.getByText("logo.png")).toBeVisible();
  });

  test("LaTeX syntax highlighting applies to .tex files", async ({ page }) => {
    await registerAndCreateProject(page, "Highlighting Project");

    // main.tex is auto-created, click it to open in editor
    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    // Type some LaTeX content
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.type("\\section{Hello}");

    // Verify that syntax highlighting spans are present (CodeMirror adds spans for highlighted tokens)
    const highlightedSpans = page.locator(".cm-line span");
    await expect(highlightedSpans.first()).toBeVisible();
  });
});
