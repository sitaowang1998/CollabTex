import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { AuthUser, FileTreeNode } from "@collab-tex/shared";
import { AuthProvider } from "../contexts/AuthContext";
import { api, ApiError } from "../lib/api";
import ProjectEditorPage from "./ProjectEditorPage";

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
      getBlob: vi.fn(),
      uploadFile: vi.fn(),
    },
  };
});

vi.mock("../lib/socket", () => ({
  getSocket: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
}));

const yjsSyncDocs: Y.Doc[] = [];

vi.mock("../lib/yjs-sync", () => {
  return {
    YjsDocumentSync: vi.fn().mockImplementation(function (
      this: Record<string, unknown>,
      options: { onSynced: () => void },
    ) {
      const doc = new Y.Doc();
      const awareness = new Awareness(doc);
      yjsSyncDocs.push(doc);
      Promise.resolve().then(() => options.onSynced());
      Object.assign(this, {
        doc,
        awareness,
        isSynced: true,
        serverVersion: 1,
        destroy: vi.fn(() => {
          awareness.destroy();
        }),
      });
    }),
  };
});

const mockedApi = vi.mocked(api);

const authUser: AuthUser = { id: "u1", email: "a@b.com", name: "Alice" };

const sampleNodes: FileTreeNode[] = [
  {
    type: "file",
    name: "main.tex",
    path: "/main.tex",
    documentId: "doc-main",
    documentKind: "text",
    mime: "text/x-tex",
  },
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
];

function setupApiMocks(overrides?: {
  projectError?: ApiError;
  treeNodes?: FileTreeNode[];
}) {
  localStorage.setItem("token", "tok");
  mockedApi.get.mockImplementation((path: string) => {
    if (path === "/auth/me") return Promise.resolve(authUser);
    if (path.endsWith("/tree")) {
      return Promise.resolve({ nodes: overrides?.treeNodes ?? sampleNodes });
    }
    if (path.endsWith("/main-document")) {
      return Promise.resolve({ mainDocument: null });
    }
    if (path.includes("/files/content")) {
      return Promise.resolve({
        document: {
          id: "doc-main",
          path: "/main.tex",
          kind: "text",
          mime: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        content: "\\documentclass{article}",
      });
    }
    if (path.match(/\/projects\/[^/]+$/)) {
      if (overrides?.projectError) {
        return Promise.reject(overrides.projectError);
      }
      return Promise.resolve({
        project: {
          id: "p1",
          name: "Test Project",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        myRole: "admin",
      });
    }
    return Promise.reject(new Error(`Unexpected GET ${path}`));
  });
  // PdfPreview fetches the latest compiled PDF on mount; default to 404 (no build yet)
  mockedApi.getBlob.mockRejectedValue(new ApiError(404, "Not found"));
}

function renderEditor() {
  const router = createMemoryRouter(
    [
      { path: "/projects/:projectId", element: <ProjectEditorPage /> },
      { path: "/", element: <div>Dashboard</div> },
      { path: "/login", element: <div>Login Page</div> },
    ],
    { initialEntries: ["/projects/p1"] },
  );
  return render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  yjsSyncDocs.forEach((doc) => doc.destroy());
  yjsSyncDocs.length = 0;
});

describe("ProjectEditorPage", () => {
  it("shows loading state initially", () => {
    localStorage.setItem("token", "tok");
    mockedApi.get.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(authUser);
      return new Promise(() => {});
    });

    renderEditor();
    expect(screen.getByText(/loading project/i)).toBeInTheDocument();
  });

  it("renders project name and file tree after load", async () => {
    setupApiMocks();
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("Test Project")).toBeInTheDocument();
    });
    expect(screen.getByText("main.tex")).toBeInTheDocument();
    expect(screen.getByText("chapters")).toBeInTheDocument();
    expect(screen.getByText("CollabTex")).toBeInTheDocument();
  });

  it("shows 'Project not found' on 404", async () => {
    setupApiMocks({ projectError: new ApiError(404, "Not found") });
    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Project not found");
    });
  });

  it("shows access denied on 403", async () => {
    setupApiMocks({ projectError: new ApiError(403, "Forbidden") });
    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "You don't have access to this project",
      );
    });
  });

  it("shows error with retry on other failures", async () => {
    setupApiMocks({ projectError: new ApiError(500, "Server error") });
    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Server error");
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("retry re-fetches data", async () => {
    const user = userEvent.setup();
    let attempt = 0;

    localStorage.setItem("token", "tok");
    mockedApi.get.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(authUser);
      if (path.match(/\/projects\/p1$/)) {
        attempt++;
        if (attempt === 1) {
          return Promise.reject(new ApiError(500, "Server error"));
        }
        return Promise.resolve({
          project: { id: "p1", name: "Test Project" },
          myRole: "admin",
        });
      }
      if (path.endsWith("/tree")) return Promise.resolve({ nodes: [] });
      if (path.endsWith("/main-document"))
        return Promise.resolve({ mainDocument: null });
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });

    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText("Test Project")).toBeInTheDocument();
    });
  });

  it("clicking a file shows it as selected", async () => {
    const user = userEvent.setup();
    setupApiMocks();
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("main.tex")).toBeInTheDocument();
    });

    await user.click(screen.getByText("main.tex"));

    await waitFor(() => {
      expect(screen.getByTestId("editor-container")).toBeInTheDocument();
    });
  });

  it("shows select-a-file message when nothing selected", async () => {
    setupApiMocks();
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("Test Project")).toBeInTheDocument();
    });
    expect(screen.getByText("Select a file to edit")).toBeInTheDocument();
  });

  it("shows Back to Dashboard link on error", async () => {
    setupApiMocks({ projectError: new ApiError(404, "Not found") });
    renderEditor();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /back to dashboard/i }),
    ).toBeInTheDocument();
  });

  it("shows tree error banner when refresh fails", async () => {
    const user = userEvent.setup();
    setupApiMocks();
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("main.tex")).toBeInTheDocument();
    });

    // Simulate: user creates a file, but tree refresh fails
    mockedApi.post.mockResolvedValueOnce({
      document: { id: "d1", path: "/new.tex" },
    });
    mockedApi.get.mockImplementation((path: string) => {
      if (path.endsWith("/tree")) {
        return Promise.reject(new ApiError(500, "Server error"));
      }
      return Promise.resolve({});
    });

    // Trigger create action via New toolbar menu
    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: "New File" }));
    await user.type(screen.getByLabelText("File path"), "new.tex");
    const dialog = screen.getByRole("dialog");
    const createBtn = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Create",
    )!;
    await user.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("clears selected file after deleting it", async () => {
    const user = userEvent.setup();
    setupApiMocks();
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("main.tex")).toBeInTheDocument();
    });

    // Select a file
    await user.click(screen.getByText("main.tex"));
    await waitFor(() => {
      expect(screen.getByTestId("editor-container")).toBeInTheDocument();
    });

    // Right-click and delete the file
    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("main.tex"),
    });
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    // Confirm delete
    mockedApi.delete.mockResolvedValueOnce(undefined);
    mockedApi.get.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(authUser);
      if (path.endsWith("/tree")) return Promise.resolve({ nodes: [] });
      return Promise.resolve({});
    });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText("Select a file to edit")).toBeInTheDocument();
    });
  });

  it("renders binary preview for binary files instead of editor", async () => {
    const user = userEvent.setup();
    const nodesWithBinary: FileTreeNode[] = [
      ...sampleNodes,
      {
        type: "file",
        name: "diagram.pdf",
        path: "/diagram.pdf",
        documentId: "doc-pdf",
        documentKind: "binary",
        mime: "application/pdf",
      },
    ];
    setupApiMocks({ treeNodes: nodesWithBinary });
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("diagram.pdf")).toBeInTheDocument();
    });

    await user.click(screen.getByText("diagram.pdf"));

    // Should show binary preview, not CodeMirror editor
    await waitFor(() => {
      expect(screen.getByText("application/pdf")).toBeInTheDocument();
    });
    expect(document.querySelector(".cm-editor")).not.toBeInTheDocument();
  });
});
