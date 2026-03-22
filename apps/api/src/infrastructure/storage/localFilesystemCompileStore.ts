import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CompileArtifactNotFoundError,
  type CompileArtifactStore,
} from "../../services/compile.js";

export function createLocalFilesystemCompileStore(
  rootDirectory: string,
): CompileArtifactStore {
  const resolvedRootDirectory = path.resolve(rootDirectory);

  return {
    writePdf: async (storagePath, content) => {
      const absolutePath = resolveStoragePath(
        resolvedRootDirectory,
        storagePath,
      );

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    },
    readPdf: async (storagePath) => {
      const absolutePath = resolveStoragePath(
        resolvedRootDirectory,
        storagePath,
      );

      try {
        return await readFile(absolutePath);
      } catch (error) {
        if (isMissingFileError(error)) {
          throw new CompileArtifactNotFoundError();
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
    throw new Error("Compile storage path must stay within the storage root");
  }

  return candidatePath;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
