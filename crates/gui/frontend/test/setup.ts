// The `/vitest` entry point declares the matchers against Vitest's `Assertion` interface.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Registered by hand because `globals` is off in vite.config.ts, and Testing Library's automatic cleanup hooks onto a
// global `afterEach`.
afterEach(cleanup);

// jsdom has no layout, so it leaves out `ResizeObserver`; Radix Slider measures its thumb with one. Nothing is ever
// resized here, so an observer that never reports is faithful.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
