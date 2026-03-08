import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const swaggerUiDist = require("swagger-ui-dist");

const host = "0.0.0.0";
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
    res.end(renderDocsIndexHtml());
    return;
  }

  if (pathname === "/openapi") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderSwaggerUiHtml());
    return;
  }

  if (pathname === "/openapi.yaml") {
    await streamFile(res, openApiSpecPath, "text/yaml; charset=utf-8");
    return;
  }

  if (pathname === "/realtime") {
    await renderMarkdownPage(res, realtimeDocPath, "Realtime API Contract");
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

async function renderMarkdownPage(res, filePath, title) {
  try {
    const markdown = await readFile(filePath, "utf8");

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderMarkdownHtml(title, markdown));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      respondNotFound(res);
      return;
    }

    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Failed to render API docs page");
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

function renderDocsIndexHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CollabTex API Docs</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        background: #f5f7fb;
        color: #162031;
        font: 16px/1.5 sans-serif;
      }

      main {
        max-width: 720px;
      }

      h1 {
        margin-top: 0;
      }

      ul {
        padding-left: 20px;
      }

      a {
        color: #0f4c81;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>CollabTex API Docs</h1>
      <p>This server only exposes the checked-in API documents from the repository.</p>
      <ul>
        <li><a href="/openapi">HTTP API contract in Swagger UI</a></li>
        <li><a href="/openapi.yaml">Raw OpenAPI YAML</a></li>
        <li><a href="/realtime">Rendered realtime contract</a></li>
        <li><a href="/realtime.md">Raw realtime markdown</a></li>
      </ul>
    </main>
  </body>
</html>`;
}

function renderSwaggerUiHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CollabTex OpenAPI</title>
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
      <a href="/">Docs index</a>
      <a href="/openapi.yaml">Raw OpenAPI</a>
      <a href="/realtime">Realtime contract</a>
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

function renderMarkdownHtml(title, markdown) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        background: #f5f7fb;
        color: #162031;
        font: 16px/1.6 sans-serif;
      }

      main {
        max-width: 840px;
      }

      nav {
        margin-bottom: 24px;
        font-size: 14px;
      }

      nav a {
        margin-right: 16px;
        color: #0f4c81;
        text-decoration: none;
      }

      h1,
      h2,
      h3 {
        line-height: 1.25;
      }

      code {
        padding: 0.1em 0.3em;
        border-radius: 4px;
        background: #e8eef8;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        font-size: 0.95em;
      }

      pre {
        overflow-x: auto;
        padding: 16px;
        border-radius: 8px;
        background: #162031;
        color: #f5f7fb;
      }

      pre code {
        padding: 0;
        background: transparent;
        color: inherit;
      }
    </style>
  </head>
  <body>
    <main>
      <nav>
        <a href="/">Docs index</a>
        <a href="/openapi">OpenAPI</a>
        <a href="/realtime.md">Raw markdown</a>
      </nav>
      ${markdownToHtml(markdown)}
    </main>
  </body>
</html>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const parts = [];
  let paragraphLines = [];
  let listItems = [];
  let codeFenceLanguage = null;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    parts.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    parts.push(
      `<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`,
    );
    listItems = [];
  };

  const flushCodeBlock = () => {
    if (codeFenceLanguage === null) {
      return;
    }

    const className =
      codeFenceLanguage.length > 0
        ? ` class="language-${escapeHtml(codeFenceLanguage)}"`
        : "";
    parts.push(
      `<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
    );
    codeFenceLanguage = null;
    codeLines = [];
  };

  for (const line of lines) {
    const codeFenceMatch = line.match(/^```(.*)$/);

    if (codeFenceMatch) {
      flushParagraph();
      flushList();

      if (codeFenceLanguage === null) {
        codeFenceLanguage = codeFenceMatch[1].trim();
      } else {
        flushCodeBlock();
      }

      continue;
    }

    if (codeFenceLanguage !== null) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);

    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      parts.push(
        `<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`,
      );
      continue;
    }

    const listMatch = line.match(/^- (.*)$/);

    if (listMatch) {
      flushParagraph();
      listItems.push(renderInlineMarkdown(listMatch[1]));
      continue;
    }

    paragraphLines.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCodeBlock();

  return parts.join("\n");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function respondNotFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function isErrnoException(error) {
  return typeof error === "object" && error !== null && "code" in error;
}
