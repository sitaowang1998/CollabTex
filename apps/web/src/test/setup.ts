import "@testing-library/jest-dom/vitest";

// pdfjs-dist requires DOMMatrix which is not available in jsdom.
// Provide a minimal stub so that importing the module does not throw.
if (typeof globalThis.DOMMatrix === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrix = class DOMMatrix {
    constructor() {
      return new Proxy(this, {
        get: () => 0,
      });
    }
  };
}
