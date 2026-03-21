# Realtime API Contract

This document is the checked-in Socket.IO contract for the realtime surface
in `apps/api`.

`workspace:join` and `workspace:opened` are the workspace entrypoint events.
The document sync/update/reset events below define the shared contract for
the Yjs-backed realtime implementation.

## Authentication

- Transport: Socket.IO (HTTP long-polling + WebSocket upgrade)
- Handshake requirement: `auth.token`
- Token format: the same JWT returned by `POST /api/auth/register` and
  `POST /api/auth/login`
- Failure behavior: the connection is rejected with `missing token` or
  `invalid token`

## Role Behavior

- `admin`, `editor`, `commenter`, and `reader` may join a workspace
- any joined project member may send `doc.sync.request` to re-sync a text
  document they are currently joined to
- `admin` and `editor` may send `doc.update` after joining the matching text
  workspace
- `commenter` and `reader` remain read-only and receive `FORBIDDEN` if they
  send `doc.update`
- Project membership is still required for all workspace and document events

## Client To Server Events

### `workspace:join`

```json
{
  "projectId": "project-123",
  "documentId": "document-456"
}
```

Validation behavior:

- payload must be an object
- `projectId` must be a non-empty string
- `documentId` must be a non-empty string

### `doc.sync.request`

```json
{
  "documentId": "document-456"
}
```

Validation behavior:

- payload must be an object
- `documentId` must be a non-empty string
- valid only after the socket has joined the matching text workspace/document
- available to any joined project member (all roles)
- membership is re-checked inside the per-document serialized queue, so
  revocations that land between the initial join and the sync request are
  caught

### `doc.update`

```json
{
  "documentId": "document-456",
  "updateB64": "AQIDBA==",
  "clientUpdateId": "client-update-123"
}
```

Validation behavior:

- payload must be an object
- `documentId` must be a non-empty string
- `updateB64` must be a non-empty base64-encoded Yjs update payload
- `clientUpdateId` must be a non-empty client-generated string
- valid only after the socket has joined the matching workspace/document
- write access is limited to `admin` and `editor`

## Server To Client Events

### `workspace:opened`

```json
{
  "projectId": "project-123",
  "document": {
    "id": "document-456",
    "path": "/main.tex",
    "kind": "text",
    "mime": "text/x-tex",
    "createdAt": "2026-03-01T12:00:00.000Z",
    "updatedAt": "2026-03-01T12:00:00.000Z"
  },
  "content": null
}
```

Behavior:

- emitted after a valid authenticated `workspace:join`
- the server verifies project membership and document existence before emitting
- `content` is metadata-only and is always `null`
- text clients must bootstrap from the automatic `doc.sync.response` emitted
  immediately after a successful join
- binary documents do not receive an automatic sync payload

### `doc.sync.response`

```json
{
  "documentId": "document-456",
  "stateB64": "AQIDBA==",
  "serverVersion": 12
}
```

Behavior:

- emitted automatically after a successful text `workspace:join`
- also emitted in response to `doc.sync.request` from the same serialized
  queue, so the returned state is post-commit relative to any earlier queued
  mutations
- contains the full encoded CRDT state from the authoritative joined active
  session after any earlier queued mutations have completed
- successful text joins attach the socket to the current generation-scoped
  text room for that active session
- snapshot-restore resets invalidate cached active sessions first, so a later
  rejoin sync reloads restored durable state instead of reusing stale
  pre-reset in-memory state
- includes the current durable document version on the server
- delivered to any joined project member, including `commenter` and `reader`

### `doc.update`

```json
{
  "documentId": "document-456",
  "updateB64": "AQIDBA==",
  "clientUpdateId": "client-update-123",
  "serverVersion": 13
}
```

Behavior:

- emitted to joined clients on the same active document session generation
  after a valid update is accepted
- the current `apps/api` implementation also emits this to the sending socket,
  so every joined client applies the same authoritative accepted delta stream
- the sender only receives this if it is still joined to that same active
  document session when the accepted update reaches the transport emit step
- echoes the sender-provided `clientUpdateId`
- carries the authoritative accepted delta produced by the server, which may
  include conflict-retry reconciliation in addition to the sender's original
  client delta
- includes the authoritative post-accept server version
- accepted `doc.update` events are emitted in the same order the server
  accepted them for that document session
- clients that received `doc.reset` but have not rejoined do not receive later
  incremental updates from the new text session generation
- delivered to all joined project members, including `commenter` and `reader`

### `doc.update.ack`

```json
{
  "documentId": "document-456",
  "clientUpdateId": "client-update-123",
  "serverVersion": 13
}
```

Behavior:

- emitted only to the socket that sent the accepted `doc.update`
- confirms which client update the server accepted
- includes the authoritative post-accept server version
- does not carry the accepted update payload; the sender receives that through
  its own `doc.update` event
- if the socket has already switched away from that session before emit time,
  the ack is suppressed

### `doc.reset`

```json
{
  "documentId": "document-456",
  "reason": "snapshot_restore",
  "serverVersion": 14
}
```

Behavior:

- emitted when the server needs clients to discard local incremental state and
  re-sync the document
- for `reason: "snapshot_restore"`, the server invalidates the previous active
  text session before broadcasting the reset, and clients are expected to
  rejoin to obtain the restored authoritative state
- the reset is broadcast to the invalidated text-session generation, and
  sockets stay isolated from the next generation until they explicitly rejoin
- accepted updates from that invalidated session are not emitted after the
  reset boundary
- includes the server version clients should treat as authoritative after the
  reset
- `serverVersion: 0` is reserved for resets where the document no longer has a
  live current-state row after the server-side change
- the current use case is snapshot restore / reopen resynchronization

### `realtime:error`

```json
{
  "code": "INVALID_REQUEST",
  "message": "projectId is required"
}
```

Error codes:

- `INVALID_REQUEST`
- `FORBIDDEN`
- `NOT_FOUND`
- `UNAVAILABLE`
- `UNAUTHORIZED` is reserved in shared types but not currently emitted by
  `realtime:error`

Behavior:

- used for validation, permission, not-found, and availability failures across
  workspace and document-level events
- examples include invalid `workspace:join` payloads, invalid `doc.update`
  payloads, document/session mismatches, and read-only members attempting to
  send `doc.update`
- stale queued `doc.update` failures that lose authority because the socket
  switched documents or a reset invalidated the old session are suppressed
  instead of being emitted into the socket's newer workspace context
- a fresh `doc.update` sent after `doc.reset` but before rejoin still receives
  `realtime:error`, because that invalidated session is still the socket's
  current session and the client must explicitly rejoin
- `doc.sync.request` failures map as:
  - `INVALID_REQUEST` for malformed payloads, document/session mismatches, and
    invalidated sessions
  - `FORBIDDEN` for lost membership
  - `UNAVAILABLE` for unexpected failures
- `doc.update` failures map as:
  - `INVALID_REQUEST` for malformed payloads, invalid base64, invalid decoded
    Yjs update payloads, and socket/document mismatches
  - `FORBIDDEN` for lost membership or missing write role
  - `NOT_FOUND` for missing or non-text documents
  - `UNAVAILABLE` for unexpected realtime persistence failures

### `compile:done`

```json
{
  "projectId": "project-123",
  "status": "success",
  "logs": "Output written on main.pdf (1 page, 12345 bytes)."
}
```

Behavior:

- emitted to the `project:{projectId}` room when a compile finishes
- sockets join the project room automatically during `workspace:join`
- `status` is `"success"` when pdflatex produces a PDF (exit code 0), or
  `"failure"` on compile error or timeout
- `logs` contains the combined stdout/stderr from the LaTeX compiler
- this event is a notification for connected clients; the HTTP endpoint that
  triggered the compile also returns the result synchronously

## Deferred From This Change

- `presence.update` is part of the broader proposal but is intentionally not
  included in the current contract
