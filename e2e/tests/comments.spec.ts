import { test, expect } from "@playwright/test";

async function registerUser(
  page: import("@playwright/test").Page,
  name: string,
) {
  const email = `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`;
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

function getProjectUrl(page: import("@playwright/test").Page): string {
  return page.url();
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

async function openFileAndType(
  page: import("@playwright/test").Page,
  filename: string,
  content: string,
) {
  await page.getByText(filename).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.type(content);
  await expect(page.locator(".cm-content")).toContainText(content);
}

async function selectTextInEditor(
  page: import("@playwright/test").Page,
  text: string,
) {
  // Click into the editor first to ensure it's focused
  await page.locator(".cm-content").click();

  // Use the browser's native Selection API to select text within CodeMirror.
  await page.evaluate(
    ({ searchText }) => {
      const content = document.querySelector(".cm-content");
      if (!content) throw new Error("No .cm-content element");

      function findTextNode(node: Node): { node: Text; offset: number } | null {
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
    { searchText: text },
  );

  // Wait for CodeMirror to process the selection change
  await page.waitForTimeout(300);
}

async function createCommentThread(
  page: import("@playwright/test").Page,
  selectText: string,
  commentBody: string,
) {
  await selectTextInEditor(page, selectText);
  // The tooltip "Add Comment" should appear near the selection
  await expect(page.getByTestId("add-comment-btn")).toBeVisible();
  await page.getByTestId("add-comment-btn").click();

  // Should show CreateCommentForm in the comment section
  await expect(page.getByTestId("create-comment-form")).toBeVisible();
  await expect(
    page.getByTestId("create-comment-form").getByText(selectText),
  ).toBeVisible();

  await page.getByLabel("Comment body").fill(commentBody);
  await page.getByRole("button", { name: "Submit" }).click();

  // Wait for thread to appear
  await expect(page.getByTestId("comment-thread").first()).toBeVisible();
}

test.describe("Comment Threads", () => {
  test("right panel shows both Preview and Comments sections", async ({
    page,
  }) => {
    await registerUser(page, "Split Panel User");
    await createProjectAndOpen(page, "Split Panel Project");

    // Both sections should be visible in the right panel
    await expect(page.getByText("Preview")).toBeVisible();
    await expect(page.getByText("Comments", { exact: true })).toBeVisible();
  });

  test("comments section shows empty state when no text file selected", async ({
    page,
  }) => {
    await registerUser(page, "No File User");
    await createProjectAndOpen(page, "No File Project");

    await expect(
      page.getByText("Select a text file to view comments"),
    ).toBeVisible();
  });

  test("comments section shows 'No comments yet' for a document with no threads", async ({
    page,
  }) => {
    await registerUser(page, "No Comments User");
    await createProjectAndOpen(page, "No Comments Project");

    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    await expect(page.getByText("No comments yet")).toBeVisible();
  });

  test("collapse and expand comments section", async ({ page }) => {
    await registerUser(page, "Collapse User");
    await createProjectAndOpen(page, "Collapse Project");

    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    // Collapse comments
    await page.getByLabel("Collapse comments").click();
    await expect(page.getByText("No comments yet")).not.toBeVisible();

    // Expand comments
    await page.getByLabel("Expand comments").click();
    await expect(page.getByText("No comments yet")).toBeVisible();
  });

  test("create a comment thread via text selection", async ({ page }) => {
    await registerUser(page, "Create Comment User");
    await createProjectAndOpen(page, "Create Comment Project");

    await openFileAndType(page, "main.tex", "Hello World Test Content");
    await page.waitForTimeout(500);

    await createCommentThread(page, "World Test", "This needs revision");

    const thread = page.getByTestId("comment-thread").first();
    await expect(thread.getByText("This needs revision")).toBeVisible();
    await expect(thread.getByTestId("thread-status")).toContainText("open");
    await expect(thread.getByText("just now").first()).toBeVisible();
  });

  test("author name is displayed instead of UUID", async ({ page }) => {
    await registerUser(page, "AuthorName User");
    await createProjectAndOpen(page, "AuthorName Project");

    await openFileAndType(page, "main.tex", "Author test content");
    await page.waitForTimeout(500);

    await createCommentThread(page, "Author test", "Check author name");

    const thread = page.getByTestId("comment-thread").first();
    await expect(thread.getByText("AuthorName User")).toBeVisible();
  });

  test("reply to an existing comment thread", async ({ page }) => {
    await registerUser(page, "Reply User");
    await createProjectAndOpen(page, "Reply Project");

    await openFileAndType(page, "main.tex", "Some content to comment on");
    await page.waitForTimeout(500);

    await createCommentThread(page, "content", "Initial comment");

    const thread = page.getByTestId("comment-thread").first();
    await thread.getByLabel("Reply").fill("I agree, let's fix this");
    await thread.getByRole("button", { name: "Reply" }).click();

    await expect(thread.getByText("I agree, let's fix this")).toBeVisible();
  });

  test("resolve and reopen a comment thread", async ({ page }) => {
    await registerUser(page, "Resolve User");
    await createProjectAndOpen(page, "Resolve Project");

    await openFileAndType(page, "main.tex", "Text for resolving");
    await page.waitForTimeout(500);

    await createCommentThread(page, "resolving", "Needs fix");

    const thread = page.getByTestId("comment-thread").first();

    // Resolve
    await thread.getByRole("button", { name: "Resolve" }).click();
    await expect(thread.getByTestId("thread-status")).toContainText("resolved");

    // Reopen
    await thread.getByRole("button", { name: "Reopen" }).click();
    await expect(thread.getByTestId("thread-status")).toContainText("open");
  });

  test("resolved thread is collapsed", async ({ page }) => {
    await registerUser(page, "Collapsed Resolve User");
    await createProjectAndOpen(page, "Collapsed Resolve Project");

    await openFileAndType(page, "main.tex", "Text for collapsing");
    await page.waitForTimeout(500);

    await createCommentThread(page, "collapsing", "Will be resolved");

    const thread = page.getByTestId("comment-thread").first();
    // Initially open: reply form is visible
    await expect(thread.getByLabel("Reply")).toBeVisible();

    // Resolve it
    await thread.getByRole("button", { name: "Resolve" }).click();
    await expect(thread.getByTestId("thread-status")).toContainText("resolved");

    // After resolve, the reply form should be hidden (collapsed)
    await expect(thread.getByLabel("Reply")).not.toBeVisible();
  });

  test("comment threads persist across page reload", async ({ page }) => {
    await registerUser(page, "Persist User");
    await createProjectAndOpen(page, "Persist Project");

    await openFileAndType(page, "main.tex", "Persistent comment text");
    await page.waitForTimeout(500);

    await createCommentThread(page, "Persistent", "Should survive reload");

    await expect(
      page
        .getByTestId("comment-thread")
        .first()
        .getByText("Persistent")
        .first(),
    ).toBeVisible();

    await page.reload();

    await page.getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    const thread = page.getByTestId("comment-thread").first();
    await expect(thread.getByText("Persistent").first()).toBeVisible();
    await expect(thread.getByText("Should survive reload")).toBeVisible();
  });

  test("reader cannot create, reply, or resolve threads", async ({
    page,
    browser,
  }) => {
    await registerUser(page, "Admin For Reader Test");
    await createProjectAndOpen(page, "Reader Test Project");
    const projectUrl = getProjectUrl(page);

    await openFileAndType(page, "main.tex", "Admin wrote this");
    await page.waitForTimeout(500);

    await createCommentThread(page, "Admin wrote", "Admin comment");

    const readerEmail = await registerSecondUser(browser, "Reader User");
    await addMember(page, readerEmail, "Reader User", "reader");

    const ctxReader = await browser.newContext();
    const readerPage = await ctxReader.newPage();
    await loginUser(readerPage, readerEmail);
    await readerPage.goto(projectUrl);
    await readerPage.getByText("main.tex").click({ force: true });
    await expect(readerPage.locator(".cm-editor")).toBeVisible();

    // Reader should NOT see Add Comment tooltip (no selection to trigger it)
    // Select text — tooltip should not appear for reader
    await selectTextInEditor(readerPage, "Admin wrote");
    await expect(readerPage.getByTestId("add-comment-btn")).not.toBeVisible();

    // Reader sees the thread content
    const readerThread = readerPage.getByTestId("comment-thread").first();
    await expect(readerThread.getByText("Admin wrote").first()).toBeVisible();
    await expect(readerThread.getByText("Admin comment")).toBeVisible();

    // Reader cannot reply or resolve
    await expect(readerThread.getByLabel("Reply")).not.toBeVisible();
    await expect(
      readerThread.getByRole("button", { name: "Resolve" }),
    ).not.toBeVisible();

    await ctxReader.close();
  });

  test("commenter can create and reply to threads", async ({
    page,
    browser,
  }) => {
    await registerUser(page, "Admin For Commenter Test");
    await createProjectAndOpen(page, "Commenter Test Project");
    const projectUrl = getProjectUrl(page);

    await openFileAndType(page, "main.tex", "Content for commenter");
    await page.waitForTimeout(500);

    const commenterEmail = await registerSecondUser(browser, "Commenter User");
    await addMember(page, commenterEmail, "Commenter User", "commenter");

    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await loginUser(pageC, commenterEmail);
    await pageC.goto(projectUrl);
    await pageC.getByText("main.tex").click({ force: true });
    await expect(pageC.locator(".cm-editor")).toBeVisible();
    await pageC.waitForTimeout(1000);

    await selectTextInEditor(pageC, "commenter");
    await expect(pageC.getByTestId("add-comment-btn")).toBeVisible();
    await pageC.getByTestId("add-comment-btn").click();

    await expect(pageC.getByTestId("create-comment-form")).toBeVisible();
    await pageC.getByLabel("Comment body").fill("Commenter's comment");
    await pageC.getByRole("button", { name: "Submit" }).click();

    await expect(pageC.getByTestId("comment-thread").first()).toBeVisible();

    const thread = pageC.getByTestId("comment-thread").first();
    await thread.getByLabel("Reply").fill("Commenter reply");
    await thread.getByRole("button", { name: "Reply" }).click();

    await expect(thread.getByText("Commenter reply")).toBeVisible();

    await ctxC.close();
  });

  test("comment anchors survive text edits before the anchored range", async ({
    page,
  }) => {
    await registerUser(page, "Anchor Test User");
    await createProjectAndOpen(page, "Anchor Test Project");

    await openFileAndType(page, "main.tex", "AAAA BBBB CCCC DDDD");
    await page.waitForTimeout(500);

    await createCommentThread(page, "CCCC", "comment on C");

    await expect(
      page.getByTestId("comment-thread").first().getByText("CCCC").first(),
    ).toBeVisible();

    // Edit text BEFORE the anchor
    await page.locator(".cm-content").click();
    await page.keyboard.press("Home");
    await page.keyboard.type("XXXX ");

    await expect(page.locator(".cm-content")).toContainText("XXXX AAAA");

    // Thread's quotedText should still be "CCCC"
    await expect(
      page.getByTestId("comment-thread").first().getByText("CCCC").first(),
    ).toBeVisible();
  });

  test("switching documents shows correct comments for each doc", async ({
    page,
  }) => {
    await registerUser(page, "Switch Doc User");
    await createProjectAndOpen(page, "Switch Doc Project");

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

    await page.getByTestId("file-tree").getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.locator(".cm-content").click();
    await page.keyboard.type("Main file content");
    await page.waitForTimeout(500);

    await createCommentThread(page, "Main file", "main comment");

    // Switch to chapter1.tex
    await page.getByTestId("file-tree").getByText("chapter1.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    await expect(page.getByText("No comments yet")).toBeVisible();

    // Switch back to main.tex
    await page.getByTestId("file-tree").getByText("main.tex").click();
    await expect(page.locator(".cm-editor")).toBeVisible();

    await expect(page.getByText("main comment")).toBeVisible();
  });

  test("multiple threads on the same document", async ({ page }) => {
    await registerUser(page, "Multi Thread User");
    await createProjectAndOpen(page, "Multi Thread Project");

    await openFileAndType(
      page,
      "main.tex",
      "First paragraph. Second paragraph.",
    );
    await page.waitForTimeout(500);

    await createCommentThread(page, "First", "Comment on first");

    await selectTextInEditor(page, "Second");
    await expect(page.getByTestId("add-comment-btn")).toBeVisible();
    await page.getByTestId("add-comment-btn").click();
    await expect(page.getByTestId("create-comment-form")).toBeVisible();
    await page.getByLabel("Comment body").fill("Comment on second");
    await page.getByRole("button", { name: "Submit" }).click();

    const threads = page.getByTestId("comment-thread");
    await expect(threads).toHaveCount(2);

    await expect(page.getByText("Comment on first")).toBeVisible();
    await expect(page.getByText("Comment on second")).toBeVisible();
  });

  test("highlighted text in editor for open comment threads", async ({
    page,
  }) => {
    await registerUser(page, "Highlight User");
    await createProjectAndOpen(page, "Highlight Project");

    await openFileAndType(page, "main.tex", "Hello highlighted text here");
    await page.waitForTimeout(500);

    await createCommentThread(page, "highlighted", "Check highlight");

    // The highlighted text should have the cm-comment-highlight class
    await expect(page.locator(".cm-comment-highlight")).toBeVisible();
  });

  test("realtime: second user sees comment created by first user", async ({
    page,
    browser,
  }) => {
    await registerUser(page, "Realtime Admin");
    await createProjectAndOpen(page, "Realtime Project");
    const projectUrl = getProjectUrl(page);

    await openFileAndType(page, "main.tex", "Realtime test content");
    await page.waitForTimeout(500);

    // Add second user
    const user2Email = await registerSecondUser(browser, "Realtime User2");
    await addMember(page, user2Email, "Realtime User2");

    // User 2 opens the project
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await loginUser(page2, user2Email);
    await page2.goto(projectUrl);
    await page2.getByText("main.tex").click({ force: true });
    await expect(page2.locator(".cm-editor")).toBeVisible();
    await page2.waitForTimeout(1000);

    // User 2 should see "No comments yet"
    await expect(page2.getByText("No comments yet")).toBeVisible();

    // User 1 creates a comment
    await createCommentThread(page, "Realtime test", "Realtime comment");

    // User 2 should see the comment appear via socket
    await expect(
      page2.getByText("Realtime comment"),
      "second user should see the comment via realtime socket",
    ).toBeVisible({ timeout: 5000 });

    await ctx2.close();
  });

  test("threads sorted by text position", async ({ page }) => {
    await registerUser(page, "Sort User");
    await createProjectAndOpen(page, "Sort Project");

    await openFileAndType(page, "main.tex", "AAA BBB CCC");
    await page.waitForTimeout(500);

    // Create comment on "CCC" first
    await createCommentThread(page, "CCC", "Comment on C");

    // Wait for the create form to disappear before creating another
    await expect(page.getByTestId("create-comment-form")).not.toBeVisible({
      timeout: 5000,
    });

    // Create comment on "AAA" second
    await selectTextInEditor(page, "AAA");
    await expect(page.getByTestId("add-comment-btn")).toBeVisible();
    await page.getByTestId("add-comment-btn").click();
    await page.getByLabel("Comment body").fill("Comment on A");
    await page.getByRole("button", { name: "Submit" }).click();

    // Wait for both threads
    await expect(page.getByTestId("comment-thread")).toHaveCount(2);

    // Threads should be sorted by position: "AAA" (pos ~0) before "CCC" (pos ~8)
    const threads = page.getByTestId("comment-thread");
    await expect(threads.nth(0)).toContainText("AAA");
    await expect(threads.nth(1)).toContainText("CCC");
  });

  test("add-comment tooltip has readable colors (dark bg, light text)", async ({
    page,
  }) => {
    await registerUser(page, "Tooltip Color User");
    await createProjectAndOpen(page, "Tooltip Color Project");
    await openFileAndType(page, "main.tex", "Some sample text for selection");

    await selectTextInEditor(page, "sample");
    await expect(page.getByTestId("add-comment-btn")).toBeVisible();

    // Compute luminance values inside the browser to handle any CSS color format
    const luminances = await page.evaluate(() => {
      const btn = document.querySelector(
        "[data-testid='add-comment-btn']",
      ) as HTMLElement | null;
      if (!btn) throw new Error("add-comment-btn not found");

      const tooltipWrapper = btn.closest(".cm-tooltip") as HTMLElement | null;
      if (!tooltipWrapper) throw new Error("cm-tooltip wrapper not found");

      // Use a canvas to convert any CSS color to RGB values
      function cssColorToRgb(
        color: string,
      ): { r: number; g: number; b: number } {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return { r, g, b };
      }

      function luminance(color: string): number {
        const { r, g, b } = cssColorToRgb(color);
        const [rl, gl, bl] = [r, g, b].map((v) => {
          const c = v / 255;
          return c <= 0.03928
            ? c / 12.92
            : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
      }

      const wrapperStyles = window.getComputedStyle(tooltipWrapper);
      const btnStyles = window.getComputedStyle(btn);

      return {
        wrapperBg: luminance(wrapperStyles.backgroundColor),
        btnBg: luminance(btnStyles.backgroundColor),
        btnColor: luminance(btnStyles.color),
      };
    });

    // Tooltip wrapper background should be dark (luminance < 0.2)
    expect(luminances.wrapperBg).toBeLessThan(0.2);

    // Button background should also be dark (not a bright white rectangle)
    expect(luminances.btnBg).toBeLessThan(0.2);

    // Button text should be light for readability against dark bg
    expect(luminances.btnColor).toBeGreaterThan(0.5);

    // Contrast ratio should be at least 3:1
    const lighter = Math.max(luminances.btnBg, luminances.btnColor);
    const darker = Math.min(luminances.btnBg, luminances.btnColor);
    const contrastRatio = (lighter + 0.05) / (darker + 0.05);
    expect(contrastRatio).toBeGreaterThanOrEqual(3);
  });
});
