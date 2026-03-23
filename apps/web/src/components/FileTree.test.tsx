import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileTreeNode, ProjectRole } from "@collab-tex/shared";
import FileTree from "./FileTree";

const sampleNodes: FileTreeNode[] = [
  {
    type: "folder",
    name: "chapters",
    path: "/chapters",
    children: [
      {
        type: "file",
        name: "intro.tex",
        path: "/chapters/intro.tex",
        documentId: "doc-intro",
        documentKind: "text",
        mime: "text/x-tex",
      },
    ],
  },
  {
    type: "file",
    name: "main.tex",
    path: "/main.tex",
    documentId: "doc-main",
    documentKind: "text",
    mime: "text/x-tex",
  },
  {
    type: "file",
    name: "image.png",
    path: "/image.png",
    documentId: "doc-img",
    documentKind: "binary",
    mime: "image/png",
  },
];

function renderTree(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  const defaultProps = {
    nodes: sampleNodes,
    selectedPath: null,
    mainDocumentId: null,
    myRole: "admin" as ProjectRole,
    onSelectFile: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
  return { ...render(<FileTree {...defaultProps} />), props: defaultProps };
}

describe("FileTree", () => {
  it("renders files and folders", () => {
    renderTree();
    expect(screen.getByText("chapters")).toBeInTheDocument();
    expect(screen.getByText("main.tex")).toBeInTheDocument();
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    expect(screen.getByText("image.png")).toBeInTheDocument();
  });

  it("collapses and expands folders via arrow click", async () => {
    const user = userEvent.setup();
    renderTree();

    expect(screen.getByText("intro.tex")).toBeInTheDocument();

    // Click the collapse arrow, not the folder name
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
  });

  it("clicking folder name selects it without toggling", async () => {
    const user = userEvent.setup();
    renderTree();

    expect(screen.getByText("intro.tex")).toBeInTheDocument();

    // Click the folder name — should select but not collapse
    await user.click(screen.getByText("chapters"));
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
  });

  it("calls onSelectFile when clicking a file", async () => {
    const user = userEvent.setup();
    const { props } = renderTree();

    await user.click(screen.getByText("main.tex"));
    expect(props.onSelectFile).toHaveBeenCalledWith({
      documentId: "doc-main",
      path: "/main.tex",
    });
  });

  it("highlights selected file", () => {
    renderTree({ selectedPath: "/main.tex" });
    const btn = screen.getByText("main.tex").closest("button");
    expect(btn).toHaveAttribute("aria-selected", "true");
  });

  it("shows main document indicator", () => {
    renderTree({ mainDocumentId: "doc-main" });
    expect(screen.getByTestId("main-indicator")).toBeInTheDocument();
    expect(screen.getByTitle("Main document")).toBeInTheDocument();
  });

  it("does not show main indicator when no match", () => {
    renderTree({ mainDocumentId: "other-id" });
    expect(screen.queryByTestId("main-indicator")).not.toBeInTheDocument();
  });

  it("opens context menu on right-click for admin", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("main.tex"),
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Set as Main Document" }),
    ).toBeInTheDocument();
  });

  it("hides Set as Main Document when file is already main", async () => {
    const user = userEvent.setup();
    renderTree({ mainDocumentId: "doc-main" });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("main.tex"),
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Set as Main Document" }),
    ).not.toBeInTheDocument();
  });

  it("context menu on folder shows New File option", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("chapters"),
    });
    expect(
      screen.getByRole("menuitem", { name: "New File" }),
    ).toBeInTheDocument();
  });

  it("does not show context menu for reader role", async () => {
    const user = userEvent.setup();
    renderTree({ myRole: "reader" });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("main.tex"),
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not show context menu for commenter role", async () => {
    const user = userEvent.setup();
    renderTree({ myRole: "commenter" });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("main.tex"),
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not show Set as Main Document for binary files", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("image.png"),
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Set as Main Document" }),
    ).not.toBeInTheDocument();
  });

  it("shows New button for admin/editor", () => {
    renderTree({ myRole: "editor" });
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("hides New button for reader", () => {
    renderTree({ myRole: "reader" });
    expect(
      screen.queryByRole("button", { name: "New" }),
    ).not.toBeInTheDocument();
  });

  it("shows menu items when New button is clicked", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("button", { name: "New" }));
    expect(
      screen.getByRole("menuitem", { name: "New File" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "New Folder" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Upload File" }),
    ).toBeInTheDocument();
  });

  it("shows empty state when no nodes", () => {
    renderTree({ nodes: [] });
    expect(screen.getByText("No files yet")).toBeInTheDocument();
  });

  it("calls onAction with create when New File clicked in toolbar menu", async () => {
    const user = userEvent.setup();
    const { props } = renderTree();

    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: "New File" }));
    expect(props.onAction).toHaveBeenCalledWith({
      type: "create",
      parentPath: "/",
    });
  });

  it("calls onAction with create-folder when New Folder clicked in toolbar menu", async () => {
    const user = userEvent.setup();
    const { props } = renderTree();

    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: "New Folder" }));
    expect(props.onAction).toHaveBeenCalledWith({
      type: "create-folder",
      parentPath: "/",
    });
  });

  it("calls onAction with upload when Upload File clicked in toolbar menu", async () => {
    const user = userEvent.setup();
    const { props } = renderTree();

    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: "Upload File" }));
    expect(props.onAction).toHaveBeenCalledWith({
      type: "upload",
      parentPath: "/",
    });
  });

  it("calls onAction from context menu item", async () => {
    const user = userEvent.setup();
    const { props } = renderTree();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("main.tex"),
    });
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(props.onAction).toHaveBeenCalledWith({
      type: "delete",
      path: "/main.tex",
      name: "main.tex",
    });
  });

  it("context menu on folder shows New Folder option", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("chapters"),
    });
    expect(
      screen.getByRole("menuitem", { name: "New Folder" }),
    ).toBeInTheDocument();
  });

  it("context menu on folder shows Upload File option", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("chapters"),
    });
    expect(
      screen.getByRole("menuitem", { name: "Upload File" }),
    ).toBeInTheDocument();
  });

  it("ctrl+click toggles multi-selection", async () => {
    const user = userEvent.setup();
    renderTree();

    // Ctrl+click main.tex
    await user.keyboard("{Control>}");
    await user.click(screen.getByText("main.tex"));

    // Ctrl+click image.png
    await user.click(screen.getByText("image.png"));
    await user.keyboard("{/Control}");

    // Both should have multi-selected styling
    const mainBtn = screen.getByText("main.tex").closest("button");
    const imgBtn = screen.getByText("image.png").closest("button");
    expect(mainBtn?.className).toContain("bg-accent");
    expect(imgBtn?.className).toContain("bg-accent");

    // Ctrl+click main.tex again to deselect
    await user.keyboard("{Control>}");
    await user.click(screen.getByText("main.tex"));
    await user.keyboard("{/Control}");

    // main.tex should no longer be multi-selected
    expect(mainBtn?.className).not.toContain("bg-accent/60");
  });
});
