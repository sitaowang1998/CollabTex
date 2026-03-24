import { EditorState } from "@codemirror/state";
import { syntaxHighlightTheme } from "./editor-theme";

describe("editor-theme", () => {
  it("exports a valid CodeMirror extension", () => {
    expect(syntaxHighlightTheme).toBeDefined();
  });

  it("can be used in EditorState.create without errors", () => {
    const state = EditorState.create({
      doc: "\\section{Hello}",
      extensions: [syntaxHighlightTheme],
    });
    expect(state.doc.toString()).toBe("\\section{Hello}");
  });
});
