# API Docs

## Files

- `openapi.yaml`: HTTP API contract
- `realtime.md`: Socket.IO contract

## Start The Docs Server

From the repo root, run:

```bash
npm run docs:api
```

Then open:

`http://localhost:3010`

## What The Docs Server Provides

The docs server serves only the checked-in API docs from this repository.

Use it to:

- view the OpenAPI contract in Swagger UI at `/openapi`
- open the raw OpenAPI file at `/openapi.yaml`
- read the realtime contract as rendered HTML at `/realtime`
- open the raw realtime markdown at `/realtime.md`
