import { invokeOr, isRecord } from "./wire";

/** Why a file was not opened or shown, as `OpenError` in `crates/gui/src/open.rs` serializes it. */
export type OpenFailure = { kind: "unknown" | "missing" | "changed" | "failed" | "task"; message: string };

const KINDS: readonly OpenFailure["kind"][] = ["unknown", "missing", "changed", "failed", "task"];

/** Open the admitted file named by `identity` in the system's default app for its type. Rejects with an {@link OpenFailure}. */
export const openMedia = (identity: string): Promise<void> => call<void>("open_media", { identity });

/**
 * Show the admitted file named by `identity` in the system file manager, selected where it supports that. Rejects with
 * an {@link OpenFailure}.
 */
export const revealMedia = (identity: string): Promise<void> => call<void>("reveal_media", { identity });

/** The {@link OpenFailure} a rejection carries, or a `task` failure for anything else, such as a missing command. */
const toFailure = (error: unknown): OpenFailure => {
    if (isRecord(error)) {
        const { kind, message } = error;
        const known = KINDS.find((k) => k === kind);
        if (known && typeof message === "string") {
            return { kind: known, message };
        }
    }

    return { kind: "task", message: String(error) };
};

const call = invokeOr(toFailure);
