import { isAbsolute, relative, resolve } from "node:path";

export type CompileInput = {
  files: Map<string, string>;
  mainFile: string;
  timeoutMs: number;
};

export type CompileResult =
  | {
      outcome: "completed";
      exitCode: number;
      logs: string;
      pdfContent?: Buffer;
    }
  | { outcome: "timeout"; logs: string };

export type CompileAdapter = {
  compile(input: CompileInput): Promise<CompileResult>;
};

export type CompileArtifactStore = {
  writePdf(storagePath: string, content: Buffer): Promise<void>;
  readPdf(storagePath: string): Promise<Buffer>;
};

export class CompileArtifactNotFoundError extends Error {
  constructor() {
    super("Compile artifact not found");
    this.name = "CompileArtifactNotFoundError";
  }
}

export class CompileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileValidationError";
  }
}

export function validateCompileInput(input: CompileInput): void {
  if (input.timeoutMs <= 0) {
    throw new CompileValidationError("timeoutMs must be greater than 0");
  }

  if (!input.mainFile) {
    throw new CompileValidationError("mainFile must not be empty");
  }

  if (isInvalidFilePath(input.mainFile)) {
    throw new CompileValidationError(
      `mainFile is not a valid relative file path: ${input.mainFile}`,
    );
  }

  if (!input.files.has(input.mainFile)) {
    throw new CompileValidationError(
      `mainFile "${input.mainFile}" is not in the provided files`,
    );
  }

  for (const key of input.files.keys()) {
    if (isInvalidFilePath(key)) {
      throw new CompileValidationError(`Invalid file path: ${key}`);
    }
  }
}

function isInvalidFilePath(filePath: string): boolean {
  if (!filePath || filePath === "." || filePath === "..") return true;
  if (isAbsolute(filePath)) return true;
  if (filePath.endsWith("/") || filePath.endsWith("\\")) return true;
  const resolved = resolve("/base", filePath);
  const rel = relative("/base", resolved);
  return (
    rel === "" ||
    rel === "." ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  );
}
