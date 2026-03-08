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

### `workspace:joined`

```json
{
  "projectId": "project-123",
  "documentId": "document-456",
  "userId": "user-789"
}
```

### `workspace:open`

```json
{
  "projectId": "project-123",
  "documentId": "document-456"
}
```

### `workspace:error`

```json
{
  "code": "INVALID_REQUEST",
  "message": "projectId is required"
}
```

Known error codes:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `INVALID_REQUEST`
