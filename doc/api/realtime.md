# Realtime API Contract

This document is the checked-in Socket.IO contract for the intended Week 2
realtime surface in `apps/api`.

`workspace:join` and `workspace:opened` remain the workspace entrypoint events.
The document sync/update/reset events below are defined now so the shared
contract stays stable while the later Yjs-backed implementation slices land.

## Authentication

- Transport: Socket.IO (HTTP long-polling + WebSocket upgrade)
- Handshake requirement: `auth.token`
- Token format: the same JWT returned by `POST /api/auth/register` and
  `POST /api/auth/login`
- Failure behavior: the connection is rejected with `missing token` or
  `invalid token`

## Role Behavior

- `admin`, `editor`, `commenter`, and `reader` may join a workspace
- the shared contract reserves `doc.sync.request` for joined project members,
  but the current `apps/api` transport does not handle that event yet
- `admin` and `editor` may send `doc.update`
- `commenter` and `reader` may receive sync/update/reset events, but are
  read-only and must not be allowed to send `doc.update`
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
- reserved in shared types, but not yet processed by the current `apps/api`
  socket transport
- valid only after the socket has joined the matching workspace/document
- intended for any joined project member once explicit re-sync support is wired

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
- the current `apps/api` implementation does not emit this in response to
  `doc.sync.request` yet because that event is not handled
- contains the full encoded CRDT state for the active document
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

- emitted to other clients joined to the same active document after a valid
  update is accepted
- echoes the sender-provided `clientUpdateId`
- includes the authoritative post-accept server version
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
- includes the server version clients should treat as authoritative after the
  reset
- `serverVersion: 0` is reserved for resets where the document no longer has a
  live current-state row after the server-side change
- the initial Week 2 use case is snapshot restore / reopen resynchronization

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

## Deferred From This Change

- `presence.update` is part of the broader proposal but is intentionally not
  included in the checked-in Week 2 contract for this slice
