# Realtime API Contract

This document is the checked-in contract for the current Socket.IO surface in `apps/api`.

## Authentication

- Transport: Socket.IO (HTTP long-polling + WebSocket upgrade)
- Handshake requirement: `auth.token`
- Token format: the same JWT returned by `POST /api/auth/register` and `POST /api/auth/login`
- Failure behavior: the connection is rejected with `missing token` or `invalid token`

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

### `workspace:error`

```json
{
  "code": "INVALID_REQUEST",
  "message": "projectId is required"
}
```

Error codes:

Currently emitted by `workspace:error`:

- `INVALID_REQUEST`
- `FORBIDDEN`
- `NOT_FOUND`
- `UNAVAILABLE`

Connection errors during authentication:

- `missing token`
- `invalid token`

Reserved in shared types but not currently emitted by `workspace:error`:

- `UNAUTHORIZED`
