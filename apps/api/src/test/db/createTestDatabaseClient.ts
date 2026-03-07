import {
  createDatabaseClient,
  type DatabaseClient,
} from "../../infrastructure/db/client.js";
import { getRequiredTestDatabaseUrl } from "./getTestDatabaseUrl.js";

export function createTestDatabaseClient(): DatabaseClient {
  return createDatabaseClient(getRequiredTestDatabaseUrl());
}
