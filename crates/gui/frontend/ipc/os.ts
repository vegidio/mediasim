import { platform } from "@tauri-apps/plugin-os";

// `platform()` is synchronous: the plugin's `init()` injects the platform into the webview before this code runs, so
// the header's traffic-light inset is right on the first render instead of jumping on the next tick. A function rather
// than a module constant so jsdom, where the plugin's global does not exist, only fails inside a call a test can mock.
/** Whether the application is running on macOS. */
export const isMacOs = () => platform() === "macos";
