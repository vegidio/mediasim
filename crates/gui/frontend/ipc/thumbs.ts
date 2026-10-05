import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { MediaType } from "./formats";

/** The URI scheme `crates/gui/src/thumbs/mod.rs` serves thumbnails over. */
const SCHEME = "thumb";

/**
 * Admit files for thumbnails. Resolves, in the same order, to an identity for each one, or `undefined` for a path
 * that is missing, is a folder or is not a supported media type, or a video whose path isn't Unicode.
 */
export const admitMedia = async (paths: string[]): Promise<(string | undefined)[]> => {
    // Rust's `None` arrives as JSON `null`, which this project spells `undefined`.
    const identities = await invoke<unknown[]>("admit_media", { paths });

    return identities.map((identity) => (typeof identity === "string" ? identity : undefined));
};

/** An admitted file, as `crates/gui/src/thumbs/commands.rs` describes it. */
export type MediaFile = {
    path: string;
    name: string;
    type: MediaType;
    /** In bytes. */
    size: number;
    /** For {@link renditionUrl}. */
    identity: string;
};

/**
 * Admit files for thumbnails, like {@link admitMedia}, and describe them. Resolves, in the same order, to each one's
 * path, name, media type, size and identity, or `undefined` for a path `admitMedia` gives no identity.
 */
export const describeMedia = async (paths: string[]): Promise<(MediaFile | undefined)[]> => {
    const files = await invoke<(MediaFile | null)[]>("describe_media", { paths });

    return files.map((file) => file ?? undefined);
};

/**
 * The address of an admitted file's thumbnail, for an `<img>`: its picture with the longer edge at most `bound`
 * pixels, from 16 to 1024. `convertFileSrc` picks the platform's form, `thumb://localhost/…` or
 * `http://thumb.localhost/…`.
 */
export const renditionUrl = (identity: string, bound: number) => `${convertFileSrc(identity, SCHEME)}?size=${bound}`;
