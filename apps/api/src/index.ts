import dotenv from "dotenv";
import http from "http";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/appConfig.js";
import { createHttpApp } from "./http/app.js";
import { createSocketServer } from "./ws/socketServer.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

const config = loadConfig();
const app = createHttpApp(config);
const server = http.createServer(app);

createSocketServer(server, config);

server.listen(config.port, () => {
  console.log(`API+Socket.io listening on http://localhost:${config.port}`);
});
