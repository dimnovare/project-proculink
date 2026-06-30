// Vitest global setup. `globals: true` in vitest.config.ts exposes describe/it/
// expect without imports; this file wires Testing Library's jest-dom matchers
// (toBeInTheDocument, etc.) and runs a DOM cleanup after each test.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom does not implement scrollIntoView; components that scroll an active tab /
// row into view (e.g. SupplierDockProfile's tab strip) would otherwise crash the
// render under test. No-op it globally.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
