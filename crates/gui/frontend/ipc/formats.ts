import { invoke } from "@tauri-apps/api/core";

/** Whether a format loads as still images or as videos. */
export type MediaType = "image" | "video";

/** A media format `mediasim` loads, as `crates/mediasim/src/media/kind.rs` serializes it. */
export type MediaFormat = {
    type: MediaType;
    /** Lowercase, without a leading dot; the first is the canonical one. */
    extensions: string[];
};

let formats: Promise<MediaFormat[]> | undefined;

/**
 * Every format `mediasim` loads, images first, in its order.
 *
 * Asked once and shared by every caller, since the list cannot change while the application runs. A failed request is
 * forgotten, so the next caller asks again.
 */
export const supportedFormats = () => {
    formats ??= invoke<MediaFormat[]>("supported_formats").catch((error: unknown) => {
        formats = undefined;
        throw error;
    });

    return formats;
};
