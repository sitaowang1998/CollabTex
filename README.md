# CollabTex

A full-stack, collaborative web platform for LaTeX authoring. Multiple users can edit, manage, compile, and review
LaTeX projects within a shared workspace in real time.

**Video Demo:** https://youtu.be/s5PjIvNoC1M

## 1. Team Information

| Name          | Student Number | Email                          |
|---------------|----------------|--------------------------------|
| Ciliang Zhang | 1011618304     | ciliang.zhang@mail.utoronto.ca |
| Sitao Wang    | 1003695101     | sitao.wang@mail.utoronto.ca    |

## 2. Motivation

LaTeX is the dominant typesetting system in scientific publishing. Virtually all papers in ACM and IEEE venues are
prepared using LaTeX. Because research is collaborative, academic papers are typically written by multiple authors,
and
are shaped significantly by advisor feedback.

Despite this need for collaboration, existing tools fall short:

- **Overleaf (free tier)** imposes strict compile-time limits that make it unsuitable for large projects. Version
  history, essential for tracking changes, is locked behind a premium paywall. Access control is all-or-nothing: every
  collaborator gets the same write permissions, with no distinction between administrators, editors, commenters, and
  readers. The limit on LaTeX compile time has been shrinking over time and now compiling a 10-page document with a
  few images would hit the limit.

- **Git-based workflows** (GitHub/GitLab) provides version control but require every collaborator to install and
  maintain a local LaTeX toolchain. There is no real-time collaborative editing, which slows iteration. Git also
  handles
  large binary files (figures, images) poorly, a frequent pain point in academic writing.

CollabTex addresses these gaps by combining real-time collaborative editing, fine-grained role-based access control,
server-side LaTeX compilation with live PDF preview, anchored commenting, and snapshot-based version control in a
single
web application.

## 3. Objectives

The objective of this project is to design and implement a collaborative LaTeX authoring platform that:

1. Enables multiple users to edit the same document simultaneously with guaranteed convergence
2. Enforces fine-grained, role-based access control (Admin, Editor, Commenter, Reader)
3. Compiles LaTeX projects server-side in isolated Docker containers and provides live PDF preview
4. Supports anchored comment threads that survive concurrent text edits
5. Provides snapshot-based version control with restore capability
6. Manages hierarchical project file structures including binary assets

## 4. Technical Stack

We chose a **separate frontend/backend architecture** over a full-stack framework (e.g., Next.js) because our system
requires both REST endpoints and `Socket.IO` endpoints for real-time editing. Keeping `socket.io` states,
authorization, and resource controls in a dedicated backend service is simpler to reason about and test.

### Backend

| Technology        | Purpose                                      |
|-------------------|----------------------------------------------|
| Node.js           | Runtime                                      |
| Express.js        | HTTP server and REST API                     |
| TypeScript        | Type safety                                  |
| Prisma            | ORM and database migrations                  |
| PostgreSQL        | Relational database                          |
| Socket.IO         | Real-time WebSocket communication            |
| Yjs               | CRDT for conflict-free collaborative editing |
| Argon2            | Password hashing                             |
| JSON Web Tokens   | Stateless authentication                     |
| Multer            | File upload handling                         |
| AWS SDK S3 Client | Optional cloud storage                       |
| Docker            | Isolated LaTeX compilation                   |

### Frontend

| Technology          | Purpose                    |
|---------------------|----------------------------|
| React               | UI framework               |
| Vite                | Dev server and bundler     |
| TypeScript          | Type safety                |
| Tailwind CSS        | Styling                    |
| CodeMirror 6        | Text editor                |
| y-codemirror.next   | CodeMirror-Yjs integration |
| Yjs                 | Client-side CRDT           |
| Socket.IO Client    | WebSocket client           |
| PDF.js              | PDF rendering              |
| React Router        | Client-side routing        |
| Lucide React        | Icons                      |
| shadcn/ui + Base UI | Component library          |

### Infrastructure

| Tool                     | Purpose                       |
|--------------------------|-------------------------------|
| Docker Compose           | Deployment                    |
| GitHub Actions           | CI for lint, build, and tests |
| Playwright               | End-to-end testing            |
| Vitest + Testing Library | Unit and integration testing  |
| Supertest                | HTTP API testing              |

### Architecture Overview

```mermaid
graph TD
    subgraph frontend[Frontend]
        browser[Browser]
    end

    subgraph backend[Backend]
        rest[REST endpoint]
        socket[Socket.IO endpoint]
        server[Express.js]
    end

    subgraph infra[Infrastructure]
        db[Postgres]
        s3[S3]
        docker["Docker (LaTeX compile)"]
    end

    browser <--> rest
    browser <--> socket
    rest <--> server
    socket <--> server
    server <--> db
    server <--> s3
    server <--> docker
```

The backend is organized in layers:

- **HTTP routes** handle REST API requests with validation middleware
- **WebSocket handlers** manage real-time document synchronization and presence
- **Services** contain business logic and orchestration
- **Repositories** encapsulate database queries via Prisma
- **Infrastructure** provides adapters for auth, storage, and compilation

## 5. Features

### 5.1 Real-Time Collaborative Editing

Multiple users can simultaneously edit the same LaTeX document with changes appearing in near-real-time. The system
guarantees convergence: all collaborators eventually see the same document state regardless of edit order.

We use a Conflict-free Replicated Data Type (CRDT) via the Yjs library. The backend maintains an in-memory Yjs
document instance per active document. Updates are transmitted bidirectionally over WebSocket using Socket.IO. The
backend periodically persists the CRDT state (binary Yjs encoding) to the database. On reconnection, clients request a
full state sync and then apply incremental updates.

We chose CRDT over Operational Transformation (OT) because CRDT relative positions provide stable anchors for our
commenting system. With OT, comment anchors are absolute offsets that require additional bookkeeping to update on every
transformation.

### 5.2 Role-Based Access Control (RBAC)

Each project enforces four permission levels:

| Role          | Capabilities                                          |
|---------------|-------------------------------------------------------|
| **Admin**     | Manage members, project settings, edit, comment, read |
| **Editor**    | Edit files, upload assets, compile, comment, read     |
| **Commenter** | Add and reply to comments, read                       |
| **Reader**    | View-only access                                      |

Authorization is enforced at three levels: on every REST request via middleware, during the WebSocket handshake, and on
every document update event. Users can only access projects they created or were explicitly invited to.

### 5.3 Secure Authentication

Users register with email and password. Passwords are hashed with Argon2 and stored securely. The backend issues a JWT
upon login, with automatic token refresh to maintain sessions. All protected endpoints validate JWTs via middleware.
Sessions persist across refreshes using HTTP-only cookies.

### 5.4 File Management and Project Structure

Each project supports hierarchical file organization:

- Create, rename, move, and delete files and folders
- Upload binary assets (images, figures, PDFs)
- Set a main `.tex` document for compilation
- Path-based storage with collision prevention

The backend stores document metadata in PostgreSQL using path-based addressing. Folder structure is logically derived
from path prefixes, avoiding the complexity of a separate directory model. Binary file content is stored via an
abstracted storage layer that supports both local filesystem and S3.

### 5.5 LaTeX Compilation with Live PDF Preview

Users compile their project and view the rendered PDF alongside the source editor. If compilation fails, error logs are
displayed for debugging.

The compilation pipeline:

1. The backend exports the workspace (all text files and binary assets) to a temporary directory
2. A Docker container runs `pdflatex` (or the configured LaTeX engine) with resource and time limits
3. Build artifacts (PDF and logs) are stored on the filesystem/S3
4. The frontend polls for build completion and renders the PDF using PDF.js
5. Users can download the compiled PDF directly

Docker isolation ensures that arbitrary LaTeX input cannot compromise the host system.

### 5.6 Side-by-Side Workspace Layout

The workspace provides a three-panel layout:

- **Left panel:** File tree with drag-and-drop support, file/folder creation, and context menus
- **Center panel:** CodeMirror editor with LaTeX syntax highlighting and collaborative cursors
- **Right panel:** Live PDF preview with page navigation & comment threads

### 5.7 Anchored Comment Threads

Users can select text in the editor and attach comment threads to that selection. Threads support:

- Replies from multiple collaborators
- Resolution (marking threads as resolved)
- Quoted text that shows the original selection
- Persistent anchors that survive concurrent edits

Comment anchors are stored as Yjs relative positions. These positions are resolved against the current CRDT state, so
they remain stable even as surrounding text is edited. If the anchored text is deleted, the thread is preserved with its
quoted text.

### 5.8 Snapshot Versioning

The platform maintains project snapshots for version control:

- Create snapshots with optional commit messages
- Browse version history
- Restore previous versions

Snapshots capture the full project state (all document text and binary files) and store them at immutable filesystem/S3
paths. Restoration replaces the working state and broadcasts a `doc.reset` WebSocket event, causing all connected
clients to resynchronize.

Snapshot creation is handled by an asynchronous job queue (`SnapshotRefreshJob`) with retry logic and error tracking.

### 5.9 Presence Awareness

Connected users see each other's cursor positions and text selections in real time. Presence data is broadcast via the
Yjs awareness protocol over WebSocket, giving collaborators visibility into who is editing what.

## 6. User Guide

### Registration and Login

Users need to log in or register to use CollabTeX.

1. Users are directed to login page.

![Empty Login Page](doc/assets/login_empty.png)

2. Existing users log in using email and password.

![Filled Login Page](doc/assets/login_filled.png)

3. New users register with email, username and password.

![Registration Page](doc/assets/register.png)

### Dashboard and Project Creation

Start from the dashboard after logging in.

1. A new user starts on an empty dashboard with no projects yet. From here, use `Create your first project` or
   `New Project`.

![Empty Dashboard](doc/assets/dashboard_empty.png)

2. Enter the project name in the creation dialog and confirm.

![New Project Dialog](doc/assets/dashboard_new.png)

3. After creation, the project appears in the dashboard list and shows your current role as an admin.

![Dashboard With Project](doc/assets/dashboard_project.png)

### Workspace Overview

Opening a project brings you to the main workspace. The left panel is the file list, the center is the LaTeX editor,
and the right side combines PDF preview and comments. The top bar gives access to `Snapshots`, `Members`, and logout.

![Workspace Overview](doc/assets/editor.png)

### File Management and Asset Upload

Use the file panel to create, organize, and upload project files.

1. Open the `New` menu in the file panel to create a file, create a folder, or upload a file.

![New Menu](doc/assets/editor_new.png)

2. Creating a folder opens a dialog where you provide the folder name, such as `assets` for images.

![New Folder Dialog](doc/assets/editor_new_folder.png)

3. Right-click on the mouse opens the context menu on the selected item to create new file, upload file, rename, move,
   or delete it.

![File Context Menu](doc/assets/editor_file_context.png)

4. Click on upload file. Use the system file picker to pick the files to upload.

4. Once an image is uploaded, reference it from LaTeX source and compile. The uploaded asset appears in the file tree,
   and the rendered figure appears in the PDF preview.

![Uploaded Asset and Preview](doc/assets/editor_image.png)

### Member Management

Open `Members` to invite collaborators and manage roles as an admin, or view all members for all users.

1. Open `Members`, enter the collaborator's email, choose a role, and add them to the project.

![Add Member Dialog](doc/assets/member_add.png)

2. Change a member's role, or remove a member.

![Member List and Role Selection](doc/assets/member_view.png)

### Comments

Use comments to discuss specific text in the document.

1. Select text in the editor and click on the `Add Comment` tooltip.

![Add Comment Action](doc/assets/comment_add.png)

2. A new draft thread appears in the comments panel with the selected text quoted. Enter the first message and submit
   it.

![New Comment Draft](doc/assets/commnet_new.png)

3. Other collaborators can reply in the same thread while continuing to edit the document.

![Reply in Comment Thread](doc/assets/commnet_reply.png)

4. When the discussion is finished, resolve the thread. Resolved threads remain visible and can be reopened later.

![Resolved Comment Thread](doc/assets/comment_resolve.png)

### Snapshots

Use snapshots to review project history and restore an earlier version.

1. Open `Snapshots` to view recent saved states of the project.

![Snapshot History](doc/assets/snapshot_view.png)

2. Choose a snapshot and confirm the restore. The confirmation dialog warns that the current working state will be
   replaced.

![Restore Confirmation](doc/assets/snaoshot_restore.png)

3. After the restore completes, the history records both the restored snapshot and the automatic save created before the
   restore.

![Snapshot History After Restore](doc/assets/snapshot_after_restore.png)

## 7. Development Guide

### Prerequisites

- Node.js 20 or later
- Docker and Docker Compose
- npm (included with Node.js)

### Environment Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd CollabTex
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root:
   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:15432/collabtex?schema=public
   JWT_SECRET=dev-secret-change-in-production
   CLIENT_ORIGIN=http://localhost:15173
   PORT=13000

   # Storage backend: "local" (default) or "s3"
   STORAGE_BACKEND=s3

   # Local storage paths (used when STORAGE_BACKEND=local)
   # SNAPSHOT_STORAGE_ROOT=var/snapshots
   # COMPILE_STORAGE_ROOT=var/compiles
   # BINARY_CONTENT_STORAGE_ROOT=var/binary-content

   # S3 configuration (used when STORAGE_BACKEND=s3)
   S3_REGION=us-east-1
   # S3_ENDPOINT=                       # optional, for S3-compatible services (e.g. MinIO)
   S3_BINARY_CONTENT_BUCKET=collabtex-binary
   S3_SNAPSHOT_BUCKET=collabtex-snapshots
   S3_COMPILE_BUCKET=collabtex-compiles
   ```

### Database Initialization

1. Start the PostgreSQL database:
   ```bash
   npm run dev:db
   ```
   This launches a PostgreSQL 16 container on port 15432.

2. Run database migrations:
   ```bash
   npm run prisma:migrate:deploy -w apps/api
   ```

### Local Development

Start both the frontend and backend in development mode:

```bash
npm run dev
```

- Frontend: `http://localhost:15173`
- Backend API: `http://localhost:13000`
- API documentation: `npm run docs:api` (Swagger UI)

Alternatively, use the all-in-one script:

```bash
npm run dev:full
```

### LaTeX Compilation

LaTeX compilation requires Docker. The backend spawns a Docker container with a LaTeX distribution to compile projects.
Ensure Docker is accessible to the process running the backend.

### Testing

```bash
# Frontend unit tests
npm run test -w apps/web

# Backend unit tests
npm run test:unit -w apps/api

# Backend integration tests (requires Docker and running database)
npm run test:integration -w apps/api

# End-to-end tests (Playwright)
npm run test:e2e

# Linting
npm run lint

# Type checking
npm run typecheck
```

### Project Structure

```
CollabTex/
├── apps/
│   ├── api/              # Backend (Express.js + Socket.IO)
│   │   ├── src/
│   │   │   ├── http/     # REST routes, middleware, validation
│   │   │   ├── ws/       # WebSocket handlers and publishers
│   │   │   ├── services/ # Business logic
│   │   │   ├── repositories/ # Data access (Prisma)
│   │   │   └── infrastructure/ # Auth, storage, compilation
│   │   └── prisma/       # Database schema and migrations
│   └── web/              # Frontend (React + Vite)
│       └── src/
│           ├── pages/    # Page components
│           ├── components/ # Reusable UI components
│           ├── lib/      # API client, socket, hooks
│           └── contexts/ # React context providers
├── packages/
│   └── shared/           # Shared TypeScript types
├── e2e/                  # Playwright end-to-end tests
├── doc/                  # API documentation and proposal
└── scripts/              # Build and utility scripts
```

## 9. AI Assistance and Verification

AI was used in three limited ways.

ChatGPT helped improve the writing quality of the proposal and final report. We used it for clarity, grammar, and
organization. We did not use it for design or implementation decisions. One limitation was that an AI-refined draft
dropped the point that Git handles large binary files poorly, so we restored that point manually.

Claude helped write the tests for frontend, backend and end-to-end tests. For each component, we ask Claude to first
inspect the existing test infrastructure, API docs, and proposal, then produced a plan, and finally wrote test code
after the plan was approved. We reviewed and corrected the generated tests to match the intended component behavior and
repository conventions. After we wrote the source code, and the tests fail, we also checked if the tests were wrong.

GitHub Copilot was also used in GitHub pull request review. We used it as an extra review pass on some PRs, then
manually evaluated its comments before deciding whether to apply them.

In all cases, we verified AI output manually against the codebase, documentation, and test results before keeping it.
Concrete examples are documented in `ai-session.md`.

## 10. Individual Contributions

### Sitao Wang

**Focus: Backend architecture and full-stack integration**

- Designed and implemented the complete backend architecture: database schema (Prisma + PostgreSQL), REST API, and
  WebSocket server
- Built the real-time collaboration engine: Yjs CRDT integration, WebSocket protocol, document synchronization, and
  graceful shutdown with state persistence
- Implemented authentication (Argon2 + JWT with token refresh) and role-based access control enforcement across REST and
  WebSocket layers
- Developed the LaTeX compilation pipeline: Docker-based isolated compilation, workspace export, PDF and log artifact
  management
- Built the snapshot versioning system: immutable snapshot storage, asynchronous job queue with retry logic, and
  snapshot restore with client resynchronization
- Implemented the comment system backend: anchored threads with Yjs relative positions, replies, resolution, and
  snapshot integration
- Added file management: binary file upload/download, content-hash-based storage, cleanup logic
- Added S3 storage support as an alternative to filesystem storage
- Wrote backend unit and integration tests
- Set up CI/CD pipelines (lint, build, test workflows)
- Contributed to frontend bug fixes and full-stack integration work

### Ciliang Zhang

**Focus: Frontend implementation**

- Built the login and registration pages with form validation
- Implemented the dashboard page with project listing and creation
- Developed the workspace editor page: three-panel layout (file tree, editor, PDF preview)
- Integrated CodeMirror with Yjs for real-time collaborative editing
- Added LaTeX syntax highlighting in the editor
- Built the PDF preview panel using PDF.js with page navigation and download support
- Implemented the comment sidebar: creating threads from text selections, replying, and resolving
- Built the membership management UI for adding, removing, and updating member roles
- Implemented binary file upload and viewer components
- Developed the snapshot UI: creating snapshots, browsing history, and restoring versions
- Built error handling UI components
- Created custom hooks for API fetching patterns
- Refactored frontend code for maintainability

## 11. Lessons Learned and Concluding Remarks

### Technical Lessons

**CRDT synchronization is harder than it looks.** While Yjs handles conflict resolution, building a robust real-time
system on top of it requires careful attention to WebSocket lifecycle management: connection ordering, reconnection,
state resynchronization, and graceful shutdown. We rebuilt the join/sync handshake path multiple times to get the
ordering guarantees right.

**Docker compilation needs clear boundaries.** Running arbitrary LaTeX in Docker containers requires explicit resource
limits (time, memory) and careful failure reporting. Early iterations had unclear error messages when compilation timed
out or when auxiliary files were missing. Investing in structured log capture and clear error propagation made the
compilation feature significantly more usable.

**Comment anchoring with CRDTs works well, but has edge cases.** Yjs relative positions provide stable anchors for
comment threads even under concurrent edits. However, handling deleted regions, document restores, and the interaction
between anchor resolution and snapshot state required additional care.

**Path-based document storage simplifies file management.** By modeling the file tree as path strings (similar to S3
object keys) rather than a recursive directory table, we avoided complex tree operations in the database. Folder
structure is derived from path prefixes, which simplified both the backend API and frontend file tree rendering.

### Process Lessons

**Dividing work along architectural boundaries reduces friction.** Splitting responsibilities into frontend and backend
tracks, with shared API contracts defined early, allowed parallel development with minimal merge conflicts. Frequent
syncs focused on interface alignment (endpoint shapes, WebSocket message types) rather than implementation details.

**Pull request reviews catch real bugs.** Requiring reviews on all changes surfaced issues like race conditions in
snapshot creation, missing authorization checks on WebSocket events, and edge cases in file rename operations that would
have been difficult to catch otherwise.

**Integration testing with a real database is worth the setup cost.** Running tests against a real PostgreSQL instance (
via Docker) caught issues that mocked tests would have missed, particularly around Prisma query behavior, constraint
violations, and transaction semantics.

### Concluding Remarks

CollabTex demonstrates that a small team can build a functional collaborative document editor with real-time
synchronization, role-based access control, server-side compilation, and version control in a four-week timeframe. The
key decisions that made this possible were: choosing Yjs (CRDT) for deterministic conflict resolution, using Docker for
safe LaTeX compilation, keeping the architecture simple (monorepo, filesystem storage, single-server deployment), and
maintaining strict CI discipline.

The project fulfills its original objectives: multiple users can collaboratively author LaTeX documents in real time,
with role-appropriate permissions, server-side PDF compilation, anchored comments for review workflows, and
snapshot-based version control for safe experimentation.
