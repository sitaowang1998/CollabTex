import { describe, expect, it } from "vitest";
import { CompileValidationError, validateCompileInput } from "./compile.js";

describe("validateCompileInput", () => {
  const validInput = {
    files: new Map([["main.tex", "\\documentclass{article}"]]),
    mainFile: "main.tex",
    timeoutMs: 5000,
  };

  it("accepts valid input", () => {
    expect(() => validateCompileInput(validInput)).not.toThrow();
  });

  it("rejects timeoutMs of 0", () => {
    expect(() => validateCompileInput({ ...validInput, timeoutMs: 0 })).toThrow(
      CompileValidationError,
    );
    expect(() => validateCompileInput({ ...validInput, timeoutMs: 0 })).toThrow(
      "timeoutMs must be greater than 0",
    );
  });

  it("rejects negative timeoutMs", () => {
    expect(() =>
      validateCompileInput({ ...validInput, timeoutMs: -1 }),
    ).toThrow("timeoutMs must be greater than 0");
  });

  it("rejects empty mainFile", () => {
    expect(() => validateCompileInput({ ...validInput, mainFile: "" })).toThrow(
      "mainFile must not be empty",
    );
  });

  it("rejects mainFile with ../ traversal", () => {
    const files = new Map([["../escape.tex", "content"]]);
    expect(() =>
      validateCompileInput({
        files,
        mainFile: "../escape.tex",
        timeoutMs: 5000,
      }),
    ).toThrow("mainFile is not a valid relative file path");
  });

  it("rejects mainFile with absolute path", () => {
    const files = new Map([["/etc/passwd", "content"]]);
    expect(() =>
      validateCompileInput({
        files,
        mainFile: "/etc/passwd",
        timeoutMs: 5000,
      }),
    ).toThrow("mainFile is not a valid relative file path");
  });

  it("rejects mainFile not present in files map", () => {
    const files = new Map([["other.tex", "content"]]);
    expect(() =>
      validateCompileInput({
        files,
        mainFile: "main.tex",
        timeoutMs: 5000,
      }),
    ).toThrow('mainFile "main.tex" is not in the provided files');
  });

  it("rejects file map key with ../ traversal", () => {
    const files = new Map([
      ["main.tex", "content"],
      ["../outside.tex", "malicious"],
    ]);
    expect(() =>
      validateCompileInput({
        files,
        mainFile: "main.tex",
        timeoutMs: 5000,
      }),
    ).toThrow("Invalid file path");
  });

  it("rejects file map key with absolute path", () => {
    const files = new Map([
      ["main.tex", "content"],
      ["/etc/shadow", "malicious"],
    ]);
    expect(() =>
      validateCompileInput({
        files,
        mainFile: "main.tex",
        timeoutMs: 5000,
      }),
    ).toThrow("Invalid file path");
  });

  it("rejects mainFile starting with /base/ (synthetic root bypass)", () => {
    const files = new Map([["/base/exploit.tex", "content"]]);
    expect(() =>
      validateCompileInput({
        files,
        mainFile: "/base/exploit.tex",
        timeoutMs: 5000,
      }),
    ).toThrow("mainFile is not a valid relative file path");
  });

  it("rejects mainFile with nested ../ traversal", () => {
    const files = new Map([["sub/../../escape.tex", "content"]]);
    expect(() =>
      validateCompileInput({
        files,
        mainFile: "sub/../../escape.tex",
        timeoutMs: 5000,
      }),
    ).toThrow("mainFile is not a valid relative file path");
  });

  it("rejects file map key with nested ../ traversal", () => {
    const files = new Map([
      ["main.tex", "content"],
      ["sub/../../outside.tex", "malicious"],
    ]);
    expect(() =>
      validateCompileInput({
        files,
        mainFile: "main.tex",
        timeoutMs: 5000,
      }),
    ).toThrow("Invalid file path");
  });

  it("rejects mainFile of '.'", () => {
    const files = new Map([[".", "content"]]);
    expect(() =>
      validateCompileInput({ files, mainFile: ".", timeoutMs: 5000 }),
    ).toThrow("mainFile is not a valid relative file path");
  });

  it("rejects mainFile of '..'", () => {
    const files = new Map([["..", "content"]]);
    expect(() =>
      validateCompileInput({ files, mainFile: "..", timeoutMs: 5000 }),
    ).toThrow("mainFile is not a valid relative file path");
  });

  it("rejects file map key of '.'", () => {
    const files = new Map([
      ["main.tex", "content"],
      [".", "malicious"],
    ]);
    expect(() =>
      validateCompileInput({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).toThrow("Invalid file path");
  });

  it("rejects file map key of '..'", () => {
    const files = new Map([
      ["main.tex", "content"],
      ["..", "malicious"],
    ]);
    expect(() =>
      validateCompileInput({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).toThrow("Invalid file path");
  });

  it("rejects empty file map key", () => {
    const files = new Map([
      ["main.tex", "content"],
      ["", "malicious"],
    ]);
    expect(() =>
      validateCompileInput({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).toThrow("Invalid file path");
  });

  it("rejects file path ending with separator", () => {
    const files = new Map([
      ["main.tex", "content"],
      ["subdir/", "malicious"],
    ]);
    expect(() =>
      validateCompileInput({ files, mainFile: "main.tex", timeoutMs: 5000 }),
    ).toThrow("Invalid file path");
  });

  it("throws CompileValidationError instances", () => {
    expect(() => validateCompileInput({ ...validInput, timeoutMs: 0 })).toThrow(
      CompileValidationError,
    );

    expect(() => validateCompileInput({ ...validInput, mainFile: "" })).toThrow(
      CompileValidationError,
    );
  });
});
