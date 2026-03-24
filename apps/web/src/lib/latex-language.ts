import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/* ------------------------------------------------------------------ */
/*  LaTeX                                                              */
/* ------------------------------------------------------------------ */

interface LatexState {
  mathDelimiter: string | null; // "$", "$$", "\\[", or "\\("
}

const MATH_CLOSERS: [string, string][] = [
  ["\\[", "\\]"],
  ["\\(", "\\)"],
  ["$$", "$$"],
  ["$", "$"],
];

const latexParser: StreamParser<LatexState> = {
  name: "latex",

  startState(): LatexState {
    return { mathDelimiter: null };
  },

  token(stream, state): string | null {
    // --- Comment ---
    if (stream.match("%")) {
      stream.skipToEnd();
      return "lineComment";
    }

    // --- Math mode ---
    if (state.mathDelimiter !== null) {
      // Try matching the closer for the current delimiter
      for (const [opener, closer] of MATH_CLOSERS) {
        if (state.mathDelimiter === opener && stream.match(closer)) {
          state.mathDelimiter = null;
          return "keyword";
        }
      }
      // Commands inside math
      if (stream.match(/^\\[a-zA-Z]+/)) return "keyword";
      if (stream.match(/^\\./)) return "keyword";
      // Braces inside math
      if (stream.eat("{") || stream.eat("}")) return "brace";
      // Math content — tagged as "string" for distinct highlight color
      stream.next();
      return "string";
    }

    // --- Math open ---
    if (stream.match("\\[")) {
      state.mathDelimiter = "\\[";
      return "keyword";
    }
    if (stream.match("\\(")) {
      state.mathDelimiter = "\\(";
      return "keyword";
    }
    if (stream.match("$$")) {
      state.mathDelimiter = "$$";
      return "keyword";
    }
    if (stream.eat("$")) {
      state.mathDelimiter = "$";
      return "keyword";
    }

    // --- Commands ---
    if (stream.match(/^\\[a-zA-Z]+/)) return "keyword";
    if (stream.match(/^\\./)) return "keyword";

    // --- Braces & brackets ---
    if (stream.eat("{") || stream.eat("}")) return "brace";
    if (stream.eat("[") || stream.eat("]")) return "squareBracket";

    // --- Plain text ---
    stream.next();
    return null;
  },
};

/* ------------------------------------------------------------------ */
/*  BibTeX                                                             */
/* ------------------------------------------------------------------ */

interface BibState {
  atLineStart: boolean;
}

const bibParser: StreamParser<BibState> = {
  name: "bibtex",

  startState(): BibState {
    return { atLineStart: true };
  },

  token(stream, state): string | null {
    // Track start-of-line for field name detection
    if (stream.sol()) state.atLineStart = true;

    // Skip leading whitespace
    if (stream.eatSpace()) return null;

    // Comment
    if (stream.match("%")) {
      stream.skipToEnd();
      return "lineComment";
    }

    // Entry type: @article, @book, etc.
    if (stream.match(/^@[a-zA-Z]+/)) {
      state.atLineStart = false;
      return "keyword";
    }

    // Field name: author = , title = , etc.
    if (state.atLineStart && stream.match(/^[a-zA-Z][\w-]*/)) {
      // Peek ahead for optional spaces and '='
      if (stream.match(/^\s*=/, false)) {
        state.atLineStart = false;
        return "attributeName";
      }
      state.atLineStart = false;
      return null;
    }

    // Braces
    if (stream.eat("{") || stream.eat("}")) {
      state.atLineStart = false;
      return "brace";
    }

    // Quoted strings
    if (stream.eat('"')) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '"') break;
      }
      state.atLineStart = false;
      return "string";
    }

    state.atLineStart = false;
    stream.next();
    return null;
  },
};

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

export const latexLanguage = StreamLanguage.define(latexParser);
export const bibLanguage = StreamLanguage.define(bibParser);

const LATEX_EXTENSIONS = new Set(["tex", "sty", "cls", "ltx"]);

export function getLanguageExtension(path: string): Extension[] {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext && LATEX_EXTENSIONS.has(ext)) return [latexLanguage];
  if (ext === "bib") return [bibLanguage];
  return [];
}
