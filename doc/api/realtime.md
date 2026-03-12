# Realtime API Contract

This document is the checked-in Socket.IO contract for the intended Week 2
realtime surface in `apps/api`.

`workspace:join`, `workspace:opened`, and `workspace:error` are the existing
foundation. The document sync/update/reset events below are defined now so the
shared contract stays stable while the later Yjs-backed implementation slices
land.

## Authentication

- Transport: Socket.IO (HTTP long-polling + WebSocket upgrade)
- Handshake requirement: `auth.token`
- Token format: the same JWT returned by `POST /api/auth/register` and
  `POST /api/auth/login`
- Failure behavior: the connection is rejected with `missing token` or
  `invalid token`

## Role Behavior

- `admin` and `editor` may join a workspace, request sync state, and send
  `doc.update`
- `commenter` and `reader` may join a workspace and receive sync/update/reset
  events, but are read-only and must not be allowed to send `doc.update`
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
  "docId": "document-456"
}
```

Validation behavior:

- payload must be an object
- `docId` must be a non-empty string
- valid only after the socket has joined the matching workspace/document

### `doc.update`

```json
{
  "docId": "document-456",
  "updateB64": "AQIDBA=="
}
```

Validation behavior:

- payload must be an object
- `docId` must be a non-empty string
- `updateB64` must be a non-empty base64-encoded Yjs update payload
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
  "content": "\\section{Intro}"
}
```

Behavior:

- emitted after a valid authenticated `workspace:join`
- the server verifies project membership and document existence before emitting
- text documents include the latest persisted snapshot-backed content
- binary documents use `null` content

### `doc.sync.response`

```json
{
  "docId": "document-456",
  "stateB64": "AQIDBA=="
}
```

Behavior:

- emitted in response to `doc.sync.request`
- contains the full encoded CRDT state for the active document
- delivered to any joined project member, including `commenter` and `reader`

### `doc.update`

```json
{
  "docId": "document-456",
  "updateB64": "AQIDBA=="
}
```

Behavior:

- emitted to other clients joined to the same active document after a valid
  update is accepted
- delivered to all joined project members, including `commenter` and `reader`

### `doc.reset`

```json
{
  "docId": "document-456",
  "reason": "snapshot-restored"
}
```

Behavior:

- emitted when the server needs clients to discard local incremental state and
  re-sync the document
- the initial Week 2 use case is snapshot restore / reopen resynchronization

### `workspace:error`

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
  `workspace:error`

## Deferred From This Change

- `presence.update` is part of the broader proposal but is intentionally not
  included in the checked-in Week 2 contract for this slice
