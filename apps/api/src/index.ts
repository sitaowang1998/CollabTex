import dotenv from "dotenv";
import http from "http";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/appConfig.js";
import { createHttpApp } from "./http/app.js";
import { createArgon2PasswordHasher } from "./infrastructure/auth/argon2PasswordHasher.js";
import { createDatabaseClient } from "./infrastructure/db/client.js";
import { createUserRepository } from "./repositories/userRepository.js";
import { createAuthService } from "./services/auth.js";
import { createSocketServer } from "./ws/socketServer.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
});

const config = loadConfig();
const databaseClient = createDatabaseClient(config.databaseUrl);
const authService = createAuthService({
  userRepository: createUserRepository(databaseClient),
  passwordHasher: createArgon2PasswordHasher(),
  jwtSecret: config.jwtSecret,
});
const app = createHttpApp(config, { authService });
const server = http.createServer(app);

createSocketServer(server, config);

server.listen(config.port, () => {
  console.log(`API+Socket.io listening on http://localhost:${config.port}`);
});
