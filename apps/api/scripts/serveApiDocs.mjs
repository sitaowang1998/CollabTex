import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const swaggerUiDist = require("swagger-ui-dist");

const host = "127.0.0.1";
const port = parsePort(process.env.API_DOCS_PORT);
const openApiSpecPath = fileURLToPath(
  new URL("../../../doc/api/openapi.yaml", import.meta.url),
);
const realtimeDocPath = fileURLToPath(
  new URL("../../../doc/api/realtime.md", import.meta.url),
);
const swaggerAssetRoot = swaggerUiDist.getAbsoluteFSPath();

const server = createServer(async (req, res) => {
  if (!req.url) {
    respondNotFound(res);
    return;
  }

  const { pathname } = new URL(req.url, `http://${host}:${port}`);

  if (pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderSwaggerUiHtml());
    return;
  }

  if (pathname === "/openapi.yaml") {
    await streamFile(res, openApiSpecPath, "text/yaml; charset=utf-8");
    return;
  }

  if (pathname === "/realtime.md") {
    await streamFile(res, realtimeDocPath, "text/markdown; charset=utf-8");
    return;
  }

  if (pathname.startsWith("/assets/")) {
    const assetName = pathname.slice("/assets/".length);
    const assetPath = resolveSwaggerAssetPath(assetName);

    if (!assetPath) {
      respondNotFound(res);
      return;
    }

    await streamFile(res, assetPath, contentTypeFor(assetPath));
    return;
  }

  respondNotFound(res);
});

server.listen(port, host, () => {
  console.log(`API docs preview running at http://${host}:${port}`);
});

server.on("error", (error) => {
  if (isErrnoException(error) && error.code === "EADDRINUSE") {
    console.error(
      `API docs preview could not start because ${host}:${port} is already in use. Try a different port with API_DOCS_PORT.`,
    );
    process.exitCode = 1;
    return;
  }

  if (isErrnoException(error) && error.code === "EPERM") {
    console.error(
      `API docs preview could not start because this environment does not allow listening on ${host}:${port}.`,
    );
    process.exitCode = 1;
    return;
  }

  console.error("API docs preview failed to start", error);
  process.exitCode = 1;
});

function parsePort(rawPort) {
  if (!rawPort) {
    return 3010;
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("API_DOCS_PORT must be a positive integer");
  }

  return port;
}

function resolveSwaggerAssetPath(assetName) {
  const assetPath = resolve(swaggerAssetRoot, assetName);
  const relativeAssetPath = relative(swaggerAssetRoot, assetPath);

  if (relativeAssetPath.startsWith("..") || isAbsolute(relativeAssetPath)) {
    return null;
  }

  return assetPath;
}

async function streamFile(res, filePath, contentType) {
  try {
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      respondNotFound(res);
      return;
    }

    res.writeHead(200, { "content-type": contentType });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      respondNotFound(res);
      return;
    }

    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Failed to read API docs asset");
  }
}

function contentTypeFor(filePath) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".html":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function renderSwaggerUiHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CollabTex API Docs</title>
    <link rel="stylesheet" href="/assets/swagger-ui.css" />
    <style>
      body {
        margin: 0;
        background: #f5f7fb;
      }

      .topbar {
        display: none;
      }

      .doc-links {
        padding: 12px 16px;
        border-bottom: 1px solid #d7dfeb;
        background: #ffffff;
        font: 14px/1.4 sans-serif;
      }

      .doc-links a {
        color: #0f4c81;
        text-decoration: none;
        margin-right: 16px;
      }
    </style>
  </head>
  <body>
    <div class="doc-links">
      <a href="/openapi.yaml">Raw OpenAPI</a>
      <a href="/realtime.md">Realtime Contract</a>
    </div>
    <div id="swagger-ui"></div>
    <script src="/assets/swagger-ui-bundle.js"></script>
    <script src="/assets/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout"
      });
    </script>
  </body>
</html>`;
}

function respondNotFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function isErrnoException(error) {
  return typeof error === "object" && error !== null && "code" in error;
}
