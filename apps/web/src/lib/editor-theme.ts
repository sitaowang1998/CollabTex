import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#7c4dff" },
  { tag: tags.lineComment, color: "#90a4ae", fontStyle: "italic" },
  { tag: tags.string, color: "#2e7d32" },
  { tag: tags.brace, color: "#d84315" },
  { tag: tags.squareBracket, color: "#6d4c41" },
  { tag: tags.attributeName, color: "#0277bd" },
]);

export const syntaxHighlightTheme = syntaxHighlighting(highlightStyle);
