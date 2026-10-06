import { convertFileSrc } from "@tauri-apps/api/core";

/** The URI scheme `crates/gui/src/video/mod.rs` serves videos over. */
const SCHEME = "video";

/**
 * The address of an admitted video, for a `<video>`: the file's own bytes, answered in byte ranges. `convertFileSrc`
 * picks the platform's form, `video://localhost/…` or `http://video.localhost/…`.
 */
export const videoUrl = (identity: string) => convertFileSrc(identity, SCHEME);
