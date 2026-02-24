# Motivation

LaTeX is widely used in scientific publishing. Nearly all papers published in ACM and IEEE journals and conferences are
prepared using LaTeX. In addition, the University of Toronto provides an official LaTeX thesis template that is used by
most graduate students. Given the collaborative nature of research, academic papers are typically written by multiple
authors. Even theses, although authored by a single student, are significantly shaped by feedback and suggestions from
the student’s advisor.

Despite this clear need for collaboration, relatively few platforms and tools effectively support multiple contributors
working on the same LaTeX project. One commonly used platform is Overleaf. However, the community version imposes a
strict limit on compile time, making it unsuitable for large LaTeX projects. Advanced features such as version history,
which are essential for tracking changes, are restricted to the premium version. In addition, Overleaf lacks
fine-grained access control. All collaborators are granted the same write permissions, with no distinction between roles
such as administrator, editor, or commenter.

Another common approach is to store the source files in a shared Git repository on GitHub or GitLab. Although this
method offers robust version control, it requires all collaborators to install and maintain a local LaTeX toolchain. It
also does not support real-time collaborative editing, which can reduce efficiency and slow down teamwork. Furthermore,
Git handles large binary files poorly, making it less suitable for academic papers that often include a substantial
number of charts and images.

# Objective and Key Features

This project aims to build a collaborative web platform for LaTeX projects, enabling users to share and edit LaTeX
source files together in a single workspace.

The platform must satisfy the following feature requirements:

- **Real-time collaboration:** Propagate edits instantly across all collaborators.
- **Role-based access control:** Provide per-project roles and permissions (for example, admin, editor, commenter,
  viewer).
- **File management:** Support uploading and organizing project files, including figures and other assets.
- **Backend compilation:** Compile LaTeX projects into PDF on the server.
- **Side-by-side viewing:** Allow users to view and edit LaTeX source while simultaneously viewing the rendered PDF.
- **Commenting:** Enable users to attach comments to specific locations in the source files.
- **Versioning:** Maintain a revision history so users can track changes and restore earlier versions.

## Core Features

### Authentication & Authorization

Users must register and log in to access the main functionalities. User can only view projects they belong to.  
All functionality routes are protected by authentication. Sessions persisted across refresh and the webpage reopened.

#### Implementation

All users must sign in with email and password. The email and hashed password are stored in the backend database. The
backend issues JWT to frontend, which will be included in all requests. Backend uses middleware to check the user
identity.

### RBAC

All collaborators are granted one of the role:

* Admin: Manage members, delete the project, etc. The owner that created the project has the admin role by default.
* Editor: Edit and upload files.
* Commenter: Add comment to source files.
* Reader: Read only access.

Backend checks the permission based on the user, and rejects unauthorized requests.

#### Implementation

The database has a table that stores the project, user and the role assigned. The backend has a middleware that checks
if the user initiating the request has the permission to perform the operation. Websock handshake loads the role once,
and the backend message handler checks the permission on each update.

### File Tree

Inside a project, admin and editor can

* Create folder and files
* Rename and move folder and files
* Delete folder and files

The frontend needs to load and update the file tree correctly and with little delay. The backend needs to guarantee that
there is no name collision.

#### Implementation

Backend stores just the list of files with absolute path. Similar to S3, the directory is just computed from the path.

### Real-Time Collaborative Editing

Users can see each other’s edits and comments live with low delay. Two browsers editing the same file must converge.

#### Implementation

We choose CRDT as the main method. Websocket is used for transport to minimize the delay. The backend maintains an
in-memory CRDT per active document. The in-memory doc is saved to disk periodically and when the document closes.

### Comments

Users can select a range of text and add a comment thread. Users can reply and resolve a comment thread. Threads
selected text range changes as the texts are edited. Threads stay accessible even if the text is deleted.

#### Implementation

Backend stores in the database a table for comment thread with relative start and end indices for each. Frontend
converts relative anchors into absolute positions in the current doc state. If the anchor can’t be resolved, show the
thread as orphaned in the sidebar.

### Versioning

A version is committed on a set interval. Users can view a previous version and diff against another version or the
current working copy, and restore a previous version.

#### Implementation

Backend commits a snapshot periodically by writing the files to the disk. The snapshot metadata is stored in the
database.  
On reset, the current working copy in the database is replaced, and an event is broadcasted through websocket, and the
frontend can sync with the server.

### LaTeX Compile \+ PDF Preview

Users can view live changes in the PDF review. If the compile fails, user can view the error logs.

#### Implementation

Backend runs LaTeX compile periodically for each active project. The compilation is orchestrated by Apache AirFlow,
where workers are containerized. The output artifacts (PDFs and logs) are cached in the file system, and metadata are
stored in the database. Frontend polls build status and load PDF periodically.

## Technical Implementation

### Separate Frontend and Backend

We choose to use React and Vite for the front end, and separate Express.js for the backend. To support the live
collaborations, the backend needs to expose a RESTful API and a WebSocket API. It is easier to use the split approach.

### Database Schema

The database needs to store the following tables.

#### User

| name      | type          |                             |
|:----------|:--------------|:----------------------------|
| id        | UUID          | auto increment, primary key |
| email     | VARCHAR(256)  | unique                      |
| password  | VARCHAR(1024) |                             |
| createdAt | TIMESTAMP     |                             |
| updatedAt | TIMESTAMP     |                             |

#### Project

| name        | type                 |                             |
|:------------|:---------------------|:----------------------------|
| id          | UUID                 | auto increment, primary key |
| name        | VARCHAR(256)         |                             |
| createdAt   | TIMESTAMP            |                             |
| updatedAt   | TIMESTAMP            |                             |
| tombstoneAt | TIMESTAMP (nullable) |                             |

#### Project Membership

| name      | type                                           |                    |
|:----------|:-----------------------------------------------|:-------------------|
| projectId | UUID                                           | FK \-\> Project.id |
| userId    | UUID                                           | FK \-\> User.id    |
| role      | ENUM('admin', 'editor', 'commenter', 'reader') |                    |

unique('projectId', 'userId')

#### Document

| name      | type                   |                             |
|-----------|------------------------|-----------------------------|
| id        | UUID                   | auto increment, primary key |
| projectId | UUID                   | FK -> Project.id            |
| kind      | ENUM('text', 'binary') |                             |
| createdAt | TIMESTAMP              |                             |
| path      | VARCHAR(1024)          |                             |
| hash      | VARCHAR(512)           |                             |

#### Snapshot

| name      | type          |                             |
|-----------|---------------|-----------------------------|
| id        | UUID          | auto increment, primary key |
| projectId | UUID          | FK -> Project.id            |
| path      | VARCHAR(1024) |                             |
| createdAt | TIMESTAMP     |                             |

#### Comment Thread

| name       | type         |                             |
|------------|--------------|-----------------------------|
| id         | UUID         | auto increment, primary key |
| projectId  | UUID         | FK -> Project.id            |
| documentId | UUID         | FK -> Document.id           |
| createdAt  | TIMESTAMP    |                             |
| startIndex | VARCHAR(512) |                             |
| endIndex   | VARCHAR(512) |                             |

#### Comment

| name      | type      |                        |
|-----------|-----------|------------------------|
| threaId   | UUID      | FK -> CommentThread.id |
| index     | UUID      |                        |
| createdAt | TIMESTAMP |                        |
| content   | TEXT      |                        |

UNIQUE KEY('threaId', 'index')

#### Build

| name       | type                                             |                             |
|------------|--------------------------------------------------|-----------------------------|
| id         | UUID                                             | auto increment, primary key |
| projectId  | UUID                                             | FK -> Project.Id            |
| status     | ENUM('Queued', 'Running', 'Succeeded', 'Failed') |                             |
| createdAt  | TIMESTAMP                                        |                             |
| finishedAt | TIMESTAMP (nullable)                             |                             |
| pdfPath    | VARCHAR(1024) (nullable)                         |                             |
| logPath    | VARCHAR(1024)                                    |                             |

### File Storage

File storage are used to store:

- Project Snapshots
- Project build artifacts

## Backend API

The backend provides two sets of APIs, a RESTful APIs for normal operations, and WebSocket messages for live update.

### RESTful API

RESTful API are grouped under `/api` namespace.

#### Auth

| API                  | Method | Auth | Request (fields)        | Response (fields)           | Notes               |
|----------------------|--------|------|-------------------------|-----------------------------|---------------------|
| `/api/auth/register` | POST   | No   | `email, password, name` | `user{id,email,name}` + JWT | 409 if email exists |
| `/api/auth/login`    | POST   | No   | `email, password`       | `user{...}` + JWT           | 401 on bad creds    |
| `/api/auth/logout`   | POST   | Yes  | —                       | 204                         | clears cookie       |
| `/api/me`            | GET    | Yes  | —                       | `user{...}`                 | —                   |

#### Projects

| API                        | Method | Role         | Request | Response                               | Notes                       |
|----------------------------|--------|--------------|---------|----------------------------------------|-----------------------------|
| `/api/projects`            | POST   | —            | `name`  | `project{id,name,mainDocId,createdAt}` | creator becomes ADMIN       |
| `/api/projects`            | GET    | —            | —       | `projects[{id,name,role,updatedAt}]`   | role included               |
| `/api/projects/:projectId` | GET    | Member       | —       | `project{...}, myRole`                 | 404 if not member           |
| `/api/projects/:projectId` | PATCH  | COLLAB/ADMIN | `name`  | `project{...}`                         | Rename project              |
| `/api/projects/:projectId` | DELETE | ADMIN        | —       | 204                                    | set he project as tombstone |

#### Members (RBAC)

| API                                        | Method | Role          | Request       | Response                            | Notes                                         |
|--------------------------------------------|--------|---------------|---------------|-------------------------------------|-----------------------------------------------|
| `/api/projects/:projectId/members`         | GET    | Member        | —             | `members[{userId,email,name,role}]` | —                                             |
| `/api/projects/:projectId/members`         | POST   | ADMIN         | `email, role` | `member{userId,role}`               | user must exist                               |
| `/api/projects/:projectId/members/:userId` | PATCH  | ADMIN         | `role`        | `member{userId,role}`               | —                                             |
| `/api/projects/:projectId/members/:userId` | DELETE | ADMIN or self | —             | 204                                 | self-leave allowed, except for the last ADMIN |

#### Files

| API                             | Method | Role         | Request              | Response           | Notes                  |
|---------------------------------|--------|--------------|----------------------|--------------------|------------------------|
| `/api/projects/:projectId/docs` | POST   | COLLAB/ADMIN | `path`               | `[{id,kind,mime}]` | creates doc + snapshot |
| `/api/projects/:projectId/docs` | PATCH  | COLLAB/ADMIN | `[{docId, newPath}]` | 204                |                        |
| `/api/projects/:projectId/docs` | DELETE | COLLAB/ADMIN | `[docId]`            | 204                |                        |

#### Comments

| API                                                | Method | Role       | Request                                 | Response                                       | Notes                    |
|----------------------------------------------------|--------|------------|-----------------------------------------|------------------------------------------------|--------------------------|
| `/api/projects/:projectId/docs/:docId/comments`    | GET    | Member     | —                                       | `threads[{threadId,status,anchor,comments[]}]` |                          |
| `/api/projects/:projectId/docs/:docId/comments`    | POST   | COMMENTER+ | `startRelB64,endRelB64,quotedText,body` | `thread{...}, comment{...}`                    | creates thread + 1st msg |
| `/api/projects/:projectId/threads/:threadId/reply` | POST   | COMMENTER+ | `body`                                  | `comment{...}`                                 | —                        |

#### Versioning

| API                                                  | Method | Role         | Request | Response                                 | Notes                  |
|------------------------------------------------------|--------|--------------|---------|------------------------------------------|------------------------|
| `/api/projects/:projectId/commits`                   | GET    | Member       | —       | `commits[{id,message,author,createdAt}]` | —                      |
| `/api/projects/:projectId/commits/:commitId`<br>     | GET    | Member       | —       | `snapshot files`                         | —                      |
| `/api/projects/:projectId/commits/:commitId/restore` | POST   | COLLAB/ADMIN | —       | `restoredCommitId`                       | broadcasts `doc.reset` |

#### Build / Compile (PDF)

| API                                            | Method | Auth | Role   | Request | Response                                              | Notes            |
|------------------------------------------------|--------|------|--------|---------|-------------------------------------------------------|------------------|
| `/api/projects/:projectId/builds/:buildId`     | GET    | Yes  | Member | —       | `build{id,status,finishedAt?,errorSummary?,pdfReady}` | FE polls         |
| `/api/projects/:projectId/builds/:buildId/pdf` | GET    | Yes  | Member | —       | `application/pdf` stream                              | 404 if not ready |
| `/api/projects/:projectId/builds/:buildId/log` | GET    | Yes  | Member | —       | `text/plain` or `{log}`                               | show on failure  |

---

### WebSocket API

WS connect: `ws://host/ws?projectId=...&docId=...` (auth via cookie/JWT)

| Type                | Direction | Role         | Payload                | Notes                          |
|---------------------|-----------|--------------|------------------------|--------------------------------|
| `doc.sync.request`  | C→S       | Member       | `{docId}`              | ask for full state             |
| `doc.sync.response` | S→C       | Member       | `{docId,stateB64}`     | full Yjs state                 |
| `doc.update`        | C→S       | COLLAB/ADMIN | `{docId,updateB64}`    | server applies + broadcasts    |
| `doc.update`        | S→C       | Member       | `{docId,updateB64}`    | incremental updates            |
| `presence.update`   | C→S       | Member       | `{docId,awarenessB64}` | optional                       |
| `presence.update`   | S→C       | Member       | `{docId,awarenessB64}` | optional                       |
| `doc.reset`         | S→C       | Member       | `{docId,reason}`       | after restore; client re-syncs |
| `error`             | S→C       | Member       | `{code,message}`       | permission/validation          |

## UI

The user interface consists of three main pages:

- Login / Register page: allow user to create an account and log in.
- Project list page: show the projects the user belongs to, and allow user to create new projects.
- Project workspace: the main editor interface, with a file tree on the left, a source editor in the middle, and a PDF
  preview on the right. A comment sidebar can be toggled on the right of the source editor.

The three pages have the following look:
![Login / Register page](login.png "Login / Register page")
![Project list page](dashboard.png "Project list page")
![Project workspace](editor.png "Project workspace")

# Timeline
