import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BinaryContentNotFoundError,
  type BinaryContentStore,
} from "../../services/binaryContent.js";

export function createLocalFilesystemBinaryContentStore(
  rootDirectory: string,
): BinaryContentStore {
  const resolvedRootDirectory = path.resolve(rootDirectory);

  return {
    put: async (storagePath, content) => {
      const absolutePath = resolveStoragePath(
        resolvedRootDirectory,
        storagePath,
      );

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    },
    get: async (storagePath) => {
      const absolutePath = resolveStoragePath(
        resolvedRootDirectory,
        storagePath,
      );

      try {
        return await readFile(absolutePath);
      } catch (error) {
        if (isMissingFileError(error)) {
          throw new BinaryContentNotFoundError();
        }

        throw error;
      }
    },
    delete: async (storagePath) => {
      const absolutePath = resolveStoragePath(
        resolvedRootDirectory,
        storagePath,
      );

      try {
        await unlink(absolutePath);
      } catch (error) {
        if (isMissingFileError(error)) {
          return;
        }

        throw error;
      }
    },
  };
}

function resolveStoragePath(
  rootDirectory: string,
  storagePath: string,
): string {
  const candidatePath = path.resolve(rootDirectory, storagePath);
  const relativePath = path.relative(rootDirectory, candidatePath);

  if (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\") ||
    path.isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    throw new Error(
      "Binary content storage path must stay within the storage root",
    );
  }

  return candidatePath;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
