import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  latexLanguage,
  bibLanguage,
  getLanguageExtension,
} from "./latex-language";

function getTokens(
  doc: string,
  lang: typeof latexLanguage,
): { from: number; to: number; name: string }[] {
  const state = EditorState.create({ doc, extensions: [lang] });
  const tree = syntaxTree(state);
  const tokens: { from: number; to: number; name: string }[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "Document") return;
      tokens.push({ from: node.from, to: node.to, name: node.name });
    },
  });
  return tokens;
}

function hasToken(
  tokens: { from: number; to: number; name: string }[],
  from: number,
  to: number,
  name: string,
) {
  return tokens.some((t) => t.from === from && t.to === to && t.name === name);
}

describe("getLanguageExtension", () => {
  it("returns latexLanguage for .tex files", () => {
    const exts = getLanguageExtension("/main.tex");
    expect(exts).toHaveLength(1);
    expect(exts[0]).toBe(latexLanguage);
  });

  it("returns latexLanguage for .sty files", () => {
    expect(getLanguageExtension("/custom.sty")[0]).toBe(latexLanguage);
  });

  it("returns latexLanguage for .cls files", () => {
    expect(getLanguageExtension("/article.cls")[0]).toBe(latexLanguage);
  });

  it("returns latexLanguage for .ltx files", () => {
    expect(getLanguageExtension("/doc.ltx")[0]).toBe(latexLanguage);
  });

  it("returns bibLanguage for .bib files", () => {
    const exts = getLanguageExtension("/refs.bib");
    expect(exts).toHaveLength(1);
    expect(exts[0]).toBe(bibLanguage);
  });

  it("returns empty array for non-LaTeX files", () => {
    expect(getLanguageExtension("/readme.md")).toEqual([]);
    expect(getLanguageExtension("/script.js")).toEqual([]);
    expect(getLanguageExtension("/data.txt")).toEqual([]);
  });

  it("handles case-insensitive extensions", () => {
    expect(getLanguageExtension("/main.TEX")[0]).toBe(latexLanguage);
    expect(getLanguageExtension("/refs.BIB")[0]).toBe(bibLanguage);
  });

  it("handles multi-dot filenames", () => {
    expect(getLanguageExtension("/my.file.tex")[0]).toBe(latexLanguage);
  });
});

describe("LaTeX tokenizer", () => {
  it("highlights commands as keyword", () => {
    // \section{Hello} → \section is keyword (0-8), { is brace, } is brace
    const tokens = getTokens("\\section{Hello}", latexLanguage);
    expect(hasToken(tokens, 0, 8, "keyword")).toBe(true);
    expect(hasToken(tokens, 8, 9, "brace")).toBe(true);
    expect(hasToken(tokens, 14, 15, "brace")).toBe(true);
  });

  it("highlights comments spanning the full line", () => {
    const tokens = getTokens("% this is a comment", latexLanguage);
    expect(hasToken(tokens, 0, 19, "lineComment")).toBe(true);
  });

  it("highlights inline math $...$ with delimiters and content", () => {
    // $x^2$ → $ keyword (0-1), x^2 string (1-4), $ keyword (4-5)
    const tokens = getTokens("$x^2$", latexLanguage);
    expect(hasToken(tokens, 0, 1, "keyword")).toBe(true);
    expect(hasToken(tokens, 4, 5, "keyword")).toBe(true);
    // Math content between delimiters should be string tokens
    const mathContent = tokens.filter(
      (t) => t.name === "string" && t.from >= 1 && t.to <= 4,
    );
    expect(mathContent.length).toBeGreaterThan(0);
  });

  it("highlights display math \\[...\\]", () => {
    // \[E=mc^2\] → \[ keyword, content string, \] keyword
    const tokens = getTokens("\\[E=mc^2\\]", latexLanguage);
    expect(hasToken(tokens, 0, 2, "keyword")).toBe(true);
    expect(hasToken(tokens, 8, 10, "keyword")).toBe(true);
    const mathContent = tokens.filter(
      (t) => t.name === "string" && t.from >= 2 && t.to <= 8,
    );
    expect(mathContent.length).toBeGreaterThan(0);
  });

  it("highlights inline math \\(...\\)", () => {
    const tokens = getTokens("\\(a+b\\)", latexLanguage);
    expect(hasToken(tokens, 0, 2, "keyword")).toBe(true);
    expect(hasToken(tokens, 5, 7, "keyword")).toBe(true);
    const mathContent = tokens.filter(
      (t) => t.name === "string" && t.from >= 2 && t.to <= 5,
    );
    expect(mathContent.length).toBeGreaterThan(0);
  });

  it("highlights display math $$...$$", () => {
    const tokens = getTokens("$$E=mc^2$$", latexLanguage);
    expect(hasToken(tokens, 0, 2, "keyword")).toBe(true);
    expect(hasToken(tokens, 8, 10, "keyword")).toBe(true);
    const mathContent = tokens.filter(
      (t) => t.name === "string" && t.from >= 2 && t.to <= 8,
    );
    expect(mathContent.length).toBeGreaterThan(0);
  });

  it("does not allow mismatched delimiters to close math", () => {
    // \[x\)y\] — \) should NOT close math opened by \[
    // String: \[  x  \)  y  \]
    // Pos:    0-2 2-3 3-5 5-6 6-8
    const tokens = getTokens("\\[x\\)y\\]", latexLanguage);
    // \] at position 6-8 closes the \[ math
    expect(hasToken(tokens, 6, 8, "keyword")).toBe(true);
    // \) inside math is treated as a command (keyword), not a closer
    expect(hasToken(tokens, 3, 5, "keyword")).toBe(true);
    // y between \) and \] is still in math (string)
    const yToken = tokens.find((t) => t.from === 5 && t.to === 6);
    expect(yToken?.name).toBe("string");
  });

  it("highlights braces", () => {
    const tokens = getTokens("{text}", latexLanguage);
    expect(hasToken(tokens, 0, 1, "brace")).toBe(true);
    expect(hasToken(tokens, 5, 6, "brace")).toBe(true);
  });

  it("highlights square brackets", () => {
    const tokens = getTokens("[opt]", latexLanguage);
    expect(hasToken(tokens, 0, 1, "squareBracket")).toBe(true);
    expect(hasToken(tokens, 4, 5, "squareBracket")).toBe(true);
  });

  it("treats escaped percent \\% as command, not comment", () => {
    const tokens = getTokens("50\\% of users", latexLanguage);
    // \% should be keyword, not lineComment
    expect(hasToken(tokens, 2, 4, "keyword")).toBe(true);
    const comments = tokens.filter((t) => t.name === "lineComment");
    expect(comments).toHaveLength(0);
  });

  it("treats escaped dollar \\$ as command, not math open", () => {
    const tokens = getTokens("costs \\$5", latexLanguage);
    expect(hasToken(tokens, 6, 8, "keyword")).toBe(true);
    const mathTokens = tokens.filter((t) => t.name === "string");
    expect(mathTokens).toHaveLength(0);
  });

  it("highlights math spanning multiple lines", () => {
    // \[\nx+y\n\] — math state should persist across lines
    const tokens = getTokens("\\[\nx+y\n\\]", latexLanguage);
    // \[ opens at 0-2
    expect(hasToken(tokens, 0, 2, "keyword")).toBe(true);
    // x+y on line 2 (positions 3-6) should be math content (string)
    const mathContent = tokens.filter(
      (t) => t.name === "string" && t.from >= 3 && t.to <= 6,
    );
    expect(mathContent.length).toBeGreaterThan(0);
    // \] closes at 7-9
    expect(hasToken(tokens, 7, 9, "keyword")).toBe(true);
  });

  it("returns no highlighted tokens for plain text", () => {
    const tokens = getTokens("just plain text", latexLanguage);
    expect(tokens).toHaveLength(0);
  });
});

describe("BibTeX tokenizer", () => {
  it("highlights entry types as keyword", () => {
    const tokens = getTokens("@article{key,", bibLanguage);
    expect(hasToken(tokens, 0, 8, "keyword")).toBe(true);
  });

  it("highlights field names as attributeName", () => {
    const tokens = getTokens("  author = {Name}", bibLanguage);
    const attrToken = tokens.find((t) => t.name === "attributeName");
    expect(attrToken).toBeDefined();
  });

  it("highlights quoted strings", () => {
    const tokens = getTokens('title = "Some Title"', bibLanguage);
    const strToken = tokens.find((t) => t.name === "string");
    expect(strToken).toBeDefined();
  });

  it("highlights comments spanning the full line", () => {
    const tokens = getTokens("% bib comment", bibLanguage);
    expect(hasToken(tokens, 0, 13, "lineComment")).toBe(true);
  });

  it("highlights braces", () => {
    const tokens = getTokens("{value}", bibLanguage);
    expect(hasToken(tokens, 0, 1, "brace")).toBe(true);
    expect(hasToken(tokens, 6, 7, "brace")).toBe(true);
  });
});
