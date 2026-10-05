import { invoke } from "@tauri-apps/api/core";

/**
 * Tell Rust the window has rendered, so it can be shown.
 *
 * The window ships hidden and is shown anyway after a grace period if this is never called; see
 * `crates/gui/src/window.rs`.
 */
export const windowReady = () => invoke<void>("window_ready");
