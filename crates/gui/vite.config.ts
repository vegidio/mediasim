import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
// From `vitest/config` rather than `vite`, so the tests share the alias and the React plugin.
import { defineConfig } from "vitest/config";

// Set by `tauri dev` when developing against a device on the network.
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
    // React Compiler memoizes components and hooks at build time.
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],

    // The runtime half of the `@/*` alias declared in tsconfig.json.
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./frontend", import.meta.url)),
        },
    },

    // Keeps Vite from obscuring Rust errors.
    clearScreen: false,

    // Tauri expects a fixed port; fail rather than silently pick another.
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        // Omitted rather than set to `undefined`, which `exactOptionalPropertyTypes` treats differently.
        ...(host && { hmr: { protocol: "ws", host, port: 1421 } }),
        watch: {
            // `src` is this crate's Rust, and Cargo has its own rebuild loop.
            ignored: ["**/src/**"],
        },
    },

    test: {
        environment: "jsdom",
        setupFiles: ["./frontend/test/setup.ts"],
        include: ["frontend/**/*.test.{ts,tsx}"],
        globals: false,
        clearMocks: true,
        restoreMocks: true,
        unstubGlobals: true,
    },
});
