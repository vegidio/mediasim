import { invoke } from "@tauri-apps/api/core";
import { outcomeReader } from "./wire";

/** Why a file was not moved, as `TrashFailure` in `crates/gui/src/trash.rs` serializes it. */
export type TrashFailure = "unknown" | "changed" | "missing" | "unchosen" | "trash";

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

/** Why a file was not deleted, as `DeleteFailure` in `crates/gui/src/trash.rs` serializes it. */
export type DeleteFailure = "unknown" | "changed" | "missing" | "unchosen" | "delete";

/** What happened to one file, as `DeleteOutcome` in `crates/gui/src/trash.rs` serializes it. */
export type DeleteOutcome = { status: "deleted" } | { status: "failed"; reason: DeleteFailure; message: string };

/**
 * Delete the admitted files named by `identities` from disk, without the Trash. Resolves, in the same order, to what
 * happened to each; one failure never stops the next file. Rejects only when the deletion couldn't be attempted at all.
 */
export const deleteMedia = async (identities: string[]): Promise<DeleteOutcome[]> => {
    const outcomes = await invoke<unknown[]>("delete_media", { identities });

    return outcomes.map(toDeleteOutcome);
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

/** The {@link TrashOutcome} a reply describes, or a `failed` one for any other shape, so it never reads as moved. */
const toOutcome = outcomeReader<{ status: "trashed" }, TrashFailure>(
    ({ status }) => (status === "trashed" ? { status } : undefined),
    ["unknown", "changed", "missing", "unchosen", "trash"],
    "trash",
);

/** The {@link DeleteOutcome} a reply describes, or a `failed` one for any other shape, so it never reads as deleted. */
const toDeleteOutcome = outcomeReader<{ status: "deleted" }, DeleteFailure>(
    ({ status }) => (status === "deleted" ? { status } : undefined),
    ["unknown", "changed", "missing", "unchosen", "delete"],
    "delete",
);

/** The {@link RestoreOutcome} a reply describes, or a `failed` one for any other shape, so it never reads as restored. */
const toRestoreOutcome = outcomeReader<{ status: "restored"; identity: string }, RestoreFailure>(
    ({ status, identity }) =>
        status === "restored" && typeof identity === "string" ? { status, identity } : undefined,
    ["unknown", "occupied", "gone", "restore"],
    "restore",
);
