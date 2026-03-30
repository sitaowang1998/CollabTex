import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileTreeAction } from "@/components/FileTree";
import { api, ApiError } from "@/lib/api";
import FileTreeActions from "./FileTreeActions";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ApiError: actual.ApiError,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      put: vi.fn(),
      uploadFile: vi.fn(),
      uploadBinaryFile: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const PROJECT_ID = "proj-1";

function renderActions(
  action: FileTreeAction | null,
  localFolderPaths: Set<string> = new Set(),
) {
  const callbacks = {
    onClose: vi.fn(),
    onComplete: vi.fn(),
    onMainDocumentChange: vi.fn(),
    onCreateFolder: vi.fn(),
  };
  const result = render(
    <FileTreeActions
      projectId={PROJECT_ID}
      action={action}
      localFolderPaths={localFolderPaths}
      {...callbacks}
    />,
  );
  return { ...result, ...callbacks };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("FileTreeActions", () => {
  describe("create", () => {
    const createAction: FileTreeAction = {
      type: "create",
      parentPath: "/chapters",
    };

    it("renders input pre-filled with parent path without leading /", () => {
      renderActions(createAction);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByLabelText("File path")).toHaveValue("chapters/");
    });

    it("validates empty path", async () => {
      const user = userEvent.setup();
      renderActions(createAction);

      const input = screen.getByLabelText("File path");
      await user.clear(input);
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "File path is required",
      );
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("submits POST and calls onComplete", async () => {
      const user = userEvent.setup();
      mockedApi.post.mockResolvedValueOnce({
        document: { id: "d1", path: "/chapters/new.tex" },
      });

      const { onComplete, onClose } = renderActions(createAction);

      await user.type(screen.getByLabelText("File path"), "new.tex");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => {
        expect(mockedApi.post).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/files`,
          { path: "/chapters/new.tex", kind: "text" },
        );
      });
      expect(onComplete).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("shows API error", async () => {
      const user = userEvent.setup();
      mockedApi.post.mockRejectedValueOnce(
        new ApiError(409, "File already exists"),
      );

      renderActions(createAction);

      await user.type(screen.getByLabelText("File path"), "new.tex");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "File already exists",
        );
      });
    });
  });

  describe("rename", () => {
    const renameAction: FileTreeAction = {
      type: "rename",
      path: "/main.tex",
      currentName: "main.tex",
    };

    it("renders input pre-filled with current name", () => {
      renderActions(renameAction);
      expect(screen.getByLabelText("New name")).toHaveValue("main.tex");
    });

    it("validates empty name", async () => {
      const user = userEvent.setup();
      renderActions(renameAction);

      const input = screen.getByLabelText("New name");
      await user.clear(input);
      await user.click(screen.getByRole("button", { name: "Rename" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    });

    it("submits PATCH and calls onComplete", async () => {
      const user = userEvent.setup();
      mockedApi.patch.mockResolvedValueOnce(undefined);

      const { onComplete } = renderActions(renameAction);

      const input = screen.getByLabelText("New name");
      await user.clear(input);
      await user.type(input, "intro.tex");
      await user.click(screen.getByRole("button", { name: "Rename" }));

      await waitFor(() => {
        expect(mockedApi.patch).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/nodes/rename`,
          { path: "/main.tex", name: "intro.tex" },
        );
      });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    const deleteAction: FileTreeAction = {
      type: "delete",
      path: "/main.tex",
      name: "main.tex",
    };

    it("shows confirmation with file name", () => {
      renderActions(deleteAction);
      expect(screen.getByText(/main\.tex/)).toBeInTheDocument();
      expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    });

    it("submits DELETE with body and calls onComplete", async () => {
      const user = userEvent.setup();
      mockedApi.delete.mockResolvedValueOnce(undefined);

      const { onComplete } = renderActions(deleteAction);

      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockedApi.delete).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/nodes`,
          { path: "/main.tex" },
        );
      });
      expect(onComplete).toHaveBeenCalled();
    });

    it("shows API error on failure", async () => {
      const user = userEvent.setup();
      mockedApi.delete.mockRejectedValueOnce(
        new ApiError(404, "Node not found"),
      );

      renderActions(deleteAction);

      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Node not found");
      });
    });
  });

  describe("set-main", () => {
    const setMainAction: FileTreeAction = {
      type: "set-main",
      documentId: "doc-1",
      path: "/main.tex",
    };

    it("shows loading state while setting main document", () => {
      mockedApi.put.mockReturnValue(new Promise(() => {}));
      renderActions(setMainAction);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Setting main document…")).toBeInTheDocument();
    });

    it("calls PUT and onMainDocumentChange", async () => {
      mockedApi.put.mockResolvedValueOnce(undefined);

      const { onMainDocumentChange, onClose } = renderActions(setMainAction);

      await waitFor(() => {
        expect(mockedApi.put).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/main-document`,
          { documentId: "doc-1" },
        );
      });
      expect(onMainDocumentChange).toHaveBeenCalledWith("doc-1");
      expect(onClose).toHaveBeenCalled();
    });

    it("shows error dialog on failure", async () => {
      mockedApi.put.mockRejectedValueOnce(
        new ApiError(400, "Document not found"),
      );

      renderActions(setMainAction);

      await waitFor(() => {
        expect(screen.getByText("Document not found")).toBeInTheDocument();
      });
    });
  });

  describe("create (root level)", () => {
    const rootCreateAction: FileTreeAction = {
      type: "create",
      parentPath: "/",
    };

    it("renders input empty for root-level create", () => {
      renderActions(rootCreateAction);
      expect(screen.getByLabelText("File path")).toHaveValue("");
    });

    it("submits with leading / prepended", async () => {
      const user = userEvent.setup();
      mockedApi.post.mockResolvedValueOnce({
        document: { id: "d1", path: "/main.tex" },
      });

      const { onComplete } = renderActions(rootCreateAction);

      await user.type(screen.getByLabelText("File path"), "main.tex");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => {
        expect(mockedApi.post).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/files`,
          { path: "/main.tex", kind: "text" },
        );
      });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe("create-folder", () => {
    const folderAction: FileTreeAction = {
      type: "create-folder",
      parentPath: "/",
    };

    it("renders folder name input", () => {
      renderActions(folderAction);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByLabelText("Folder name")).toBeInTheDocument();
    });

    it("validates empty name", async () => {
      const user = userEvent.setup();
      renderActions(folderAction);

      await user.click(screen.getByRole("button", { name: "Create" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Folder name is required",
      );
    });

    it("validates name with /", async () => {
      const user = userEvent.setup();
      renderActions(folderAction);

      await user.type(screen.getByLabelText("Folder name"), "a/b");
      await user.click(screen.getByRole("button", { name: "Create" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Folder name cannot contain /",
      );
    });

    it("calls onCreateFolder with parentPath and name", async () => {
      const user = userEvent.setup();
      const { onCreateFolder, onClose } = renderActions(folderAction);

      await user.type(screen.getByLabelText("Folder name"), "chapters");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(onCreateFolder).toHaveBeenCalledWith("/", "chapters");
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("delete-multiple", () => {
    const deleteMultiAction: FileTreeAction = {
      type: "delete-multiple",
      items: [
        { path: "/main.tex", name: "main.tex" },
        { path: "/intro.tex", name: "intro.tex" },
      ],
    };

    it("shows confirmation with item count", () => {
      renderActions(deleteMultiAction);
      expect(screen.getByText(/2 items/)).toBeInTheDocument();
      expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    });

    it("deletes all items and calls onComplete", async () => {
      const user = userEvent.setup();
      mockedApi.delete.mockResolvedValue(undefined);

      const { onComplete } = renderActions(deleteMultiAction);

      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockedApi.delete).toHaveBeenCalledTimes(2);
      });
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes`,
        { path: "/main.tex" },
      );
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes`,
        { path: "/intro.tex" },
      );
      expect(onComplete).toHaveBeenCalled();
    });

    it("filters redundant child paths", async () => {
      const user = userEvent.setup();
      mockedApi.delete.mockResolvedValue(undefined);

      const parentChildAction: FileTreeAction = {
        type: "delete-multiple",
        items: [
          { path: "/chapters", name: "chapters" },
          { path: "/chapters/intro.tex", name: "intro.tex" },
        ],
      };
      const { onComplete } = renderActions(parentChildAction);

      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockedApi.delete).toHaveBeenCalledTimes(1);
      });
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes`,
        { path: "/chapters" },
      );
      expect(onComplete).toHaveBeenCalled();
    });

    it("skips API call for local-only folders", async () => {
      const user = userEvent.setup();
      mockedApi.delete.mockResolvedValue(undefined);

      const mixedAction: FileTreeAction = {
        type: "delete-multiple",
        items: [
          { path: "/main.tex", name: "main.tex" },
          { path: "/local-folder", name: "local-folder" },
        ],
      };
      const { onComplete } = renderActions(
        mixedAction,
        new Set(["/local-folder"]),
      );

      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockedApi.delete).toHaveBeenCalledTimes(1);
      });
      expect(mockedApi.delete).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes`,
        { path: "/main.tex" },
      );
      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe("delete local folder", () => {
    it("skips API call for local-only folder", async () => {
      const user = userEvent.setup();
      const localAction: FileTreeAction = {
        type: "delete",
        path: "/local-dir",
        name: "local-dir",
      };
      const { onComplete, onClose } = renderActions(
        localAction,
        new Set(["/local-dir"]),
      );

      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });
      expect(mockedApi.delete).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("move", () => {
    const moveAction: FileTreeAction = {
      type: "move",
      path: "/main.tex",
      name: "main.tex",
    };

    it("renders destination input defaulting to /", () => {
      renderActions(moveAction);
      expect(screen.getByLabelText("Destination folder")).toHaveValue("/");
    });

    it("submits PATCH with null for root destination and calls onComplete", async () => {
      const user = userEvent.setup();
      mockedApi.patch.mockResolvedValueOnce(undefined);

      const { onComplete, onClose } = renderActions(moveAction);

      await user.click(screen.getByRole("button", { name: "Move" }));

      await waitFor(() => {
        expect(mockedApi.patch).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/nodes/move`,
          { path: "/main.tex", destinationParentPath: null },
        );
      });
      expect(onComplete).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("submits PATCH with folder path for non-root destination", async () => {
      const user = userEvent.setup();
      mockedApi.patch.mockResolvedValueOnce(undefined);

      renderActions(moveAction);

      const input = screen.getByLabelText("Destination folder");
      await user.clear(input);
      await user.type(input, "/chapters");
      await user.click(screen.getByRole("button", { name: "Move" }));

      await waitFor(() => {
        expect(mockedApi.patch).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/nodes/move`,
          { path: "/main.tex", destinationParentPath: "/chapters" },
        );
      });
    });

    it("shows API error on conflict", async () => {
      const user = userEvent.setup();
      mockedApi.patch.mockRejectedValueOnce(
        new ApiError(409, "Destination already has a file with this name"),
      );

      renderActions(moveAction);

      await user.click(screen.getByRole("button", { name: "Move" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Destination already has a file with this name",
        );
      });
    });

    it("pre-fills destination from DnD drop target", () => {
      const dndMoveAction: FileTreeAction = {
        type: "move",
        path: "/main.tex",
        name: "main.tex",
        destination: "/chapters",
      };
      renderActions(dndMoveAction);
      expect(screen.getByLabelText("Destination folder")).toHaveValue(
        "/chapters",
      );
    });
  });

  describe("move-multiple", () => {
    const moveMultiAction: FileTreeAction = {
      type: "move-multiple",
      items: [
        { path: "/main.tex", name: "main.tex" },
        { path: "/intro.tex", name: "intro.tex" },
      ],
    };

    it("shows item count in heading", () => {
      renderActions(moveMultiAction);
      expect(screen.getByText(/Move 2 items/)).toBeInTheDocument();
    });

    it("moves all items and calls onComplete", async () => {
      const user = userEvent.setup();
      mockedApi.patch.mockResolvedValue(undefined);

      const { onComplete } = renderActions(moveMultiAction);

      await user.click(screen.getByRole("button", { name: "Move" }));

      await waitFor(() => {
        expect(mockedApi.patch).toHaveBeenCalledTimes(2);
      });
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes/move`,
        { path: "/main.tex", destinationParentPath: null },
      );
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes/move`,
        { path: "/intro.tex", destinationParentPath: null },
      );
      expect(onComplete).toHaveBeenCalled();
    });

    it("deduplicates child paths", async () => {
      const user = userEvent.setup();
      mockedApi.patch.mockResolvedValue(undefined);

      const parentChildAction: FileTreeAction = {
        type: "move-multiple",
        items: [
          { path: "/chapters", name: "chapters" },
          { path: "/chapters/intro.tex", name: "intro.tex" },
        ],
      };
      renderActions(parentChildAction);

      await user.click(screen.getByRole("button", { name: "Move" }));

      await waitFor(() => {
        expect(mockedApi.patch).toHaveBeenCalledTimes(1);
      });
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes/move`,
        { path: "/chapters", destinationParentPath: null },
      );
    });

    it("shows error on partial failure", async () => {
      const user = userEvent.setup();
      mockedApi.patch
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ApiError(409, "Conflict on second item"));

      renderActions(moveMultiAction);

      await user.click(screen.getByRole("button", { name: "Move" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Conflict on second item",
        );
      });
      expect(
        screen.getByText(/Some items may have been moved/),
      ).toBeInTheDocument();
    });

    it("preserves relative structure for different-depth files", async () => {
      const user = userEvent.setup();
      mockedApi.patch.mockResolvedValue(undefined);

      const deepAction: FileTreeAction = {
        type: "move-multiple",
        items: [
          { path: "/src/a.tex", name: "a.tex" },
          { path: "/src/lib/b.tex", name: "b.tex" },
        ],
        destination: "/archive",
      };
      const { onComplete } = renderActions(deepAction);

      await user.click(screen.getByRole("button", { name: "Move" }));

      await waitFor(() => {
        expect(mockedApi.patch).toHaveBeenCalledTimes(2);
      });
      // a.tex is directly in /src (common parent), so moves to /archive
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes/move`,
        { path: "/src/a.tex", destinationParentPath: "/archive" },
      );
      // b.tex is in /src/lib, so preserves /lib relative to common parent
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes/move`,
        { path: "/src/lib/b.tex", destinationParentPath: "/archive/lib" },
      );
      expect(onComplete).toHaveBeenCalled();
    });

    it("preserves structure when common parent is root", async () => {
      const user = userEvent.setup();
      mockedApi.patch.mockResolvedValue(undefined);

      const crossRootAction: FileTreeAction = {
        type: "move-multiple",
        items: [
          { path: "/a.tex", name: "a.tex" },
          { path: "/folder/b.tex", name: "b.tex" },
        ],
        destination: "/dest",
      };
      const { onComplete } = renderActions(crossRootAction);

      await user.click(screen.getByRole("button", { name: "Move" }));

      await waitFor(() => {
        expect(mockedApi.patch).toHaveBeenCalledTimes(2);
      });
      // a.tex is at root (common parent = /), so moves to /dest
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes/move`,
        { path: "/a.tex", destinationParentPath: "/dest" },
      );
      // b.tex is in /folder, so preserves /folder relative to root
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/nodes/move`,
        { path: "/folder/b.tex", destinationParentPath: "/dest/folder" },
      );
      expect(onComplete).toHaveBeenCalled();
    });

    it("pre-fills destination from DnD drop", () => {
      const dndAction: FileTreeAction = {
        type: "move-multiple",
        items: [{ path: "/a.tex", name: "a.tex" }],
        destination: "/archive",
      };
      renderActions(dndAction);
      expect(screen.getByLabelText("Destination folder")).toHaveValue(
        "/archive",
      );
    });
  });

  describe("upload", () => {
    const uploadAction: FileTreeAction = {
      type: "upload",
      parentPath: "/chapters",
    };

    it("renders a hidden file input", () => {
      const { container } = renderActions(uploadAction);
      const input = container.querySelector('input[type="file"]');
      expect(input).toBeInTheDocument();
      expect(input).toHaveClass("hidden");
    });

    it("uploads binary file in single request on file selection", async () => {
      mockedApi.uploadBinaryFile.mockResolvedValueOnce({
        document: { id: "doc-new", path: "/chapters/photo.png" },
      });

      const { onComplete, onClose, container } = renderActions(uploadAction);

      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["fake-content"], "photo.png", {
        type: "image/png",
      });
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(mockedApi.uploadBinaryFile).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/files/upload`,
          file,
          "/chapters/photo.png",
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });

      expect(onComplete).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("shows 413 error with specific message", async () => {
      mockedApi.uploadBinaryFile.mockRejectedValueOnce(
        new ApiError(413, "file exceeds maximum size of 50 MB"),
      );

      const { container } = renderActions(uploadAction);

      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["big"], "big.bin", {
        type: "application/octet-stream",
      });
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "File too large. Maximum size is 50 MB.",
        );
      });
    });

    it("shows generic API error message", async () => {
      mockedApi.uploadBinaryFile.mockRejectedValueOnce(
        new ApiError(409, "File already exists"),
      );

      const { container } = renderActions(uploadAction);

      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["data"], "exists.png", { type: "image/png" });
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "File already exists",
        );
      });
    });

    it("shows generic error for non-ApiError rejection", async () => {
      mockedApi.uploadBinaryFile.mockRejectedValueOnce(
        new TypeError("something broke"),
      );

      const { container } = renderActions(uploadAction);

      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["data"], "file.bin", {
        type: "application/octet-stream",
      });
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "An unexpected error occurred",
        );
      });
    });

    it("does not call onComplete when upload fails", async () => {
      mockedApi.uploadBinaryFile.mockRejectedValueOnce(
        new ApiError(500, "Internal server error"),
      );

      const { onComplete, onClose, container } = renderActions(uploadAction);

      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["data"], "fail.bin", {
        type: "application/octet-stream",
      });
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Internal server error",
        );
      });
      expect(onComplete).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("builds correct path when parentPath is root", async () => {
      const rootUpload: FileTreeAction = { type: "upload", parentPath: "/" };
      mockedApi.uploadBinaryFile.mockResolvedValueOnce({
        document: { id: "doc-new", path: "/logo.png" },
      });

      const { container } = renderActions(rootUpload);

      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["img"], "logo.png", { type: "image/png" });
      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(mockedApi.uploadBinaryFile).toHaveBeenCalledWith(
          `/projects/${PROJECT_ID}/files/upload`,
          file,
          "/logo.png",
          expect.anything(),
        );
      });
    });
  });

  it("renders nothing when action is null", () => {
    const { container } = renderActions(null);
    expect(container).toBeEmptyDOMElement();
  });
});
