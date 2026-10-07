import { invoke } from "@tauri-apps/api/core";
import type { MediaType } from "./formats";
import { invokeOr, isRecord } from "./wire";

/** A file's details, read from its header by `probe_media` in `crates/gui/src/pair.rs`. */
export type MediaInfo = {
    path: string;
    type: MediaType;
    width: number;
    height: number;
    /** In bytes. */
    size: number;
    /** In seconds; videos only. */
    duration?: number;
    /** RFC 3339, in UTC, when the filesystem records it. */
    created?: string;
    /** RFC 3339, in UTC, when the filesystem records it. */
    modified?: string;
    /** The image format's name, such as `JPEG`; images only. */
    format?: string;
    /** The image's color profile name, such as `Display P3`, when it declares one. */
    colorProfile?: string;
    /** In frames per second, when the video's container declares it. */
    frameRate?: number;
};

/** Why a comparison or a probe failed, as `PairError` in `crates/gui/src/pair.rs` serializes it. */
export type PairFailure =
    | { kind: "cancelled" }
    | { kind: "load"; path: string; message: string }
    | { kind: "mismatch"; message: string }
    | { kind: "task"; message: string };

type OptionalKey = "duration" | "created" | "modified" | "format" | "colorProfile" | "frameRate";

/** {@link MediaInfo} as it arrives, with each absent value as JSON `null`. */
type WireMediaInfo = Omit<MediaInfo, OptionalKey> & { [K in OptionalKey]-?: NonNullable<MediaInfo[K]> | null };

/** Read one file's details from its header, without decoding it. Rejects with a {@link PairFailure}. */
export const probeMedia = async (path: string): Promise<MediaInfo> => {
    const info = await call<WireMediaInfo>("probe_media", { path });

    // Rust's `None` arrives as JSON `null`, which this project spells as an absent property.
    const { duration, created, modified, format, colorProfile, frameRate, ...always } = info;

    return {
        ...always,
        ...(duration !== null && { duration }),
        ...(created !== null && { created }),
        ...(modified !== null && { modified }),
        ...(format !== null && { format }),
        ...(colorProfile !== null && { colorProfile }),
        ...(frameRate !== null && { frameRate }),
    };
};

/**
 * Load both files and resolve to their similarity, from 0 (completely different) to 1 (identical). Starting a
 * comparison cancels any earlier one still running, which then rejects as `cancelled`. Rejects with a
 * {@link PairFailure}.
 */
export const comparePair = (a: string, b: string): Promise<number> => call<number>("compare_pair", { a, b });

/** Cancel the comparison in flight, if any. */
export const cancelComparison = () => invoke<void>("cancel_comparison");

/** The {@link PairFailure} a rejection carries, or a `task` failure for anything else, such as a missing command. */
const toFailure = (error: unknown): PairFailure => {
    if (isRecord(error)) {
        const { kind, path, message } = error;
        if (kind === "cancelled") {
            return { kind };
        }
        if (kind === "load" && typeof path === "string" && typeof message === "string") {
            return { kind, path, message };
        }
        if ((kind === "mismatch" || kind === "task") && typeof message === "string") {
            return { kind, message };
        }
    }

    return { kind: "task", message: String(error) };
};

const call = invokeOr(toFailure);
