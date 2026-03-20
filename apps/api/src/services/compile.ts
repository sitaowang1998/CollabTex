export type CompileInput = {
  files: Map<string, string>;
  mainFile: string;
  timeoutMs: number;
};

export type CompileResult = {
  success: boolean;
  exitCode: number | null;
  logs: string;
  timedOut: boolean;
};

export type CompileAdapter = {
  compile(input: CompileInput): Promise<CompileResult>;
};
