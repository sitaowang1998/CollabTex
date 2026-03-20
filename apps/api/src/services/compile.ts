import { isAbsolute, relative, resolve } from "node:path";

export type CompileInput = {
  files: Map<string, string>;
  mainFile: string;
  timeoutMs: number;
};

export type CompileResult =
  | { outcome: "completed"; exitCode: number; logs: string }
  | { outcome: "timeout"; logs: string };

export type CompileAdapter = {
  compile(input: CompileInput): Promise<CompileResult>;
};

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

  if (isEscapingPath(input.mainFile)) {
    throw new CompileValidationError(
      `mainFile path escapes working directory: ${input.mainFile}`,
    );
  }

  if (!input.files.has(input.mainFile)) {
    throw new CompileValidationError(
      `mainFile "${input.mainFile}" is not in the provided files`,
    );
  }

  for (const key of input.files.keys()) {
    if (isEscapingPath(key)) {
      throw new CompileValidationError(
        `File path escapes working directory: ${key}`,
      );
    }
  }
}

function isEscapingPath(filePath: string): boolean {
  const resolved = resolve("/base", filePath);
  const rel = relative("/base", resolved);
  return rel.startsWith("..") || isAbsolute(rel);
}
