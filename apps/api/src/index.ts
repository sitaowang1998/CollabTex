import "dotenv/config";
import http from "http";
import { loadConfig } from "./config/appConfig";
import { createHttpApp } from "./http/app";
import { createSocketServer } from "./ws/socketServer";

const config = loadConfig();
const app = createHttpApp(config);
const server = http.createServer(app);

createSocketServer(server, config);

server.listen(config.port, () => {
  console.log(`API+Socket.io listening on http://localhost:${config.port}`);
});
