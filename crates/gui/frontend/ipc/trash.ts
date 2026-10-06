import { invoke } from "@tauri-apps/api/core";

/** Why a file was not moved, as `TrashFailure` in `crates/gui/src/trash.rs` serializes it. */
export type TrashFailure = "unknown" | "changed" | "missing" | "trash";

/** What happened to one file, as `TrashOutcome` in `crates/gui/src/trash.rs` serializes it. */
export type TrashOutcome = { status: "trashed" } | { status: "failed"; reason: TrashFailure; message: string };

/**
 * Move the admitted files named by `identities` to the platform's Trash. Resolves, in the same order, to what
 * happened to each; one failure never stops the next file. Rejects only when the move couldn't be attempted at all.
 */
export const trashMedia = async (identities: string[]): Promise<TrashOutcome[]> => {
    const outcomes = await invoke<unknown[]>("trash_media", { identities });

    return outcomes.map(toOutcome);
};

/** Why a file was not restored, as `RestoreFailure` in `crates/gui/src/trash.rs` serializes it. */
export type RestoreFailure = "unknown" | "occupied" | "gone" | "restore";

/**
 * What happened to one file, as `RestoreOutcome` in `crates/gui/src/trash.rs` serializes it. A restored file comes back
 * with the identity it is admitted as now.
 */
export type RestoreOutcome =
    | { status: "restored"; identity: string }
    | { status: "failed"; reason: RestoreFailure; message: string };

/**
 * Put the files moved to the Trash as `identities` back where they were. Resolves, in the same order, to what happened
 * to each; one failure never stops the next file. Rejects only when the restore couldn't be attempted at all.
 */
export const restoreMedia = async (identities: string[]): Promise<RestoreOutcome[]> => {
    const outcomes = await invoke<unknown[]>("restore_media", { identities });

    return outcomes.map(toRestoreOutcome);
};

const REASONS: readonly unknown[] = ["unknown", "changed", "missing", "trash"] satisfies TrashFailure[];
const RESTORE_REASONS: readonly unknown[] = ["unknown", "occupied", "gone", "restore"] satisfies RestoreFailure[];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isReason = (value: unknown): value is TrashFailure => REASONS.includes(value);

/** The {@link TrashOutcome} `value` describes, or a `failed` one for any other shape, so it never reads as moved. */
const toOutcome = (value: unknown): TrashOutcome => {
    if (isRecord(value)) {
        const { status, reason, message } = value;
        if (status === "trashed") {
            return { status };
        }
        if (status === "failed" && isReason(reason) && typeof message === "string") {
            return { status, reason, message };
        }
    }

    return { status: "failed", reason: "trash", message: "the reply was not understood" };
};

const isRestoreReason = (value: unknown): value is RestoreFailure => RESTORE_REASONS.includes(value);

/** The {@link RestoreOutcome} `value` describes, or a `failed` one for any other shape, so it never reads as restored. */
const toRestoreOutcome = (value: unknown): RestoreOutcome => {
    if (isRecord(value)) {
        const { status, identity, reason, message } = value;
        if (status === "restored" && typeof identity === "string") {
            return { status, identity };
        }
        if (status === "failed" && isRestoreReason(reason) && typeof message === "string") {
            return { status, reason, message };
        }
    }

    return { status: "failed", reason: "restore", message: "the reply was not understood" };
};
