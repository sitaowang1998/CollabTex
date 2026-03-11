import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  InvalidSnapshotDataError,
  parseProjectSnapshotState,
  SnapshotDataNotFoundError,
  type ProjectSnapshotState,
  type SnapshotStore,
} from "../../services/snapshot.js";

export function createLocalFilesystemSnapshotStore(
  rootDirectory: string,
): SnapshotStore {
  const resolvedRootDirectory = path.resolve(rootDirectory);

  return {
    readProjectSnapshot: async (storagePath) => {
      const absolutePath = resolveStoragePath(
        resolvedRootDirectory,
        storagePath,
      );

      try {
        const rawSnapshot = await readFile(absolutePath, "utf8");
        return parseProjectSnapshotState(parseSnapshotJson(rawSnapshot));
      } catch (error) {
        if (isMissingFileError(error)) {
          throw new SnapshotDataNotFoundError();
        }

        throw error;
      }
    },
    writeProjectSnapshot: async (storagePath, snapshot) => {
      const absolutePath = resolveStoragePath(
        resolvedRootDirectory,
        storagePath,
      );

      await mkdir(path.dirname(absolutePath), {
        recursive: true,
      });
      await writeFile(
        absolutePath,
        JSON.stringify(snapshot satisfies ProjectSnapshotState),
        "utf8",
      );
    },
  };
}

function parseSnapshotJson(rawSnapshot: string): unknown {
  try {
    return JSON.parse(rawSnapshot) as unknown;
  } catch {
    throw new InvalidSnapshotDataError("snapshot payload must be valid JSON");
  }
}

function resolveStoragePath(
  rootDirectory: string,
  storagePath: string,
): string {
  const candidatePath = path.resolve(rootDirectory, storagePath);
  const relativePath = path.relative(rootDirectory, candidatePath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    throw new Error("Snapshot storage path must stay within the storage root");
  }

  return candidatePath;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
