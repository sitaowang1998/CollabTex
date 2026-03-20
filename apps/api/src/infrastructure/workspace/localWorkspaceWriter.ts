import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkspaceWriter } from "../../services/workspaceExport.js";

export function createLocalWorkspaceWriter(): WorkspaceWriter {
  return {
    writeWorkspace: async (files) => {
      const directory = join(tmpdir(), `collabtex-workspace-${randomUUID()}`);
      await mkdir(directory, { recursive: true });

      try {
        for (const file of files) {
          const filePath = resolveExportPath(directory, file.relativePath);

          await mkdir(dirname(filePath), { recursive: true });

          if (file.kind === "text") {
            await writeFile(filePath, file.content, "utf8");
          } else {
            await writeFile(filePath, file.content);
          }
        }
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(
          (cleanupError) => {
            console.error(
              `Failed to clean up workspace directory ${directory}:`,
              cleanupError,
            );
          },
        );
        throw error;
      }

      return {
        directory,
        cleanup: async () => {
          await rm(directory, { recursive: true, force: true }).catch(
            (cleanupError) => {
              console.error(
                `Failed to clean up workspace directory ${directory}:`,
                cleanupError,
              );
            },
          );
        },
      };
    },
  };
}

function resolveExportPath(directory: string, relativePath: string): string {
  const filePath = resolve(directory, relativePath);
  const rel = relative(directory, filePath);

  if (
    !rel ||
    rel === "." ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  ) {
    throw new Error(`File path escapes export directory: ${relativePath}`);
  }

  return filePath;
}
