# API Docs

## Files

- `openapi.yaml`: HTTP API contract
- `realtime.md`: Socket.IO contract

## Start The Swagger Server

From the repo root, run:

```bash
npm run docs:api
```

Then open:

```text
http://127.0.0.1:3010
```

## What The Swagger Server Provides

The Swagger server serves the checked-in HTTP API docs from `openapi.yaml`.

Use it to:

- view available endpoints
- inspect request and response shapes
- check auth requirements
- check expected status codes
