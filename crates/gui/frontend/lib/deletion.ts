import { type DeleteOutcome, deleteMedia, restoreMedia, type TrashOutcome, trashMedia } from "@/ipc/trash";
import { type DeletionMode, useSettingsStore } from "@/stores/settings";

/**
 * Where the deletion of the marked files stands: not started, awaiting confirmation, removing them, or restoring files
 * moved. The mode is the one in force when the deletion was asked for, and `confirmed` says whether the confirmation
 * was shown. A removal and a restore never run at once.
 */
export type Deletion =
    | { status: "idle" }
    | { status: "confirming"; mode: DeletionMode }
    | { status: "removing"; mode: DeletionMode; confirmed: boolean }
    | { status: "restoring" };

/** The deletion button's label for `count` files: "Move N to Trash" or "Delete N permanently", with "…" to confirm. */
export const deletionLabel = (mode: DeletionMode, confirm: boolean, count: number) =>
    `${mode === "trash" ? `Move ${count} to Trash` : `Delete ${count} permanently`}${confirm ? "…" : ""}`;

/** A file to remove or restore: the caller's key for it, and the identity it is admitted as. */
export type Removable<K> = { key: K; identity: string };

/** How a removal or a restore went: the keys of the files it was done to, and each one it wasn't with the reason. */
export type Settled<K> = { done: K[]; failed: { key: K; message: string }[] };

/**
 * The result of the last move to the Trash, permanent deletion or restore: the keys of the files it was done to, and
 * each one it wasn't with the reason.
 */
export type Notice<K> = { action: DeletionMode | "restore" } & Settled<K>;

/** What Undo puts back after `notice`: the files its move moved that are still in the Trash. */
export const undoable = <K>(notice: Notice<K> | undefined, trashed: (key: K) => boolean): K[] =>
    notice?.action === "trash" ? notice.done.filter(trashed) : [];

const IDLE: Deletion = { status: "idle" };

/**
 * The actions of a store that deletes its marked files with `remove`, while `hasMarked` says some are:
 *
 * - `requestDeletion` starts removing them in the deletion mode in force, asking to confirm first while the settings
 *   say so. It does nothing while none is marked or another deletion or restore is under way.
 * - `cancelDeletion` closes the confirmation without removing anything.
 * - `removeMarked` removes them in the confirming mode, once confirmed.
 */
export const deletionActions = (
    get: () => { deletion: Deletion },
    set: (state: { deletion: Deletion }) => void,
    hasMarked: () => boolean,
    remove: (mode: DeletionMode, confirmed: boolean) => Promise<void>,
) => ({
    requestDeletion: async () => {
        if (get().deletion.status !== "idle" || !hasMarked()) return;

        // Read once, so this deletion keeps its mode whatever Settings says by the time it is confirmed.
        const { deletionMode, confirmDeletion } = useSettingsStore.getState();
        if (confirmDeletion) set({ deletion: { status: "confirming", mode: deletionMode } });
        else await remove(deletionMode, false);
    },

    cancelDeletion: () => {
        if (get().deletion.status === "confirming") set({ deletion: IDLE });
    },

    removeMarked: async () => {
        const { deletion } = get();
        if (deletion.status === "confirming") await remove(deletion.mode, true);
    },
});

type Failed = { status: "failed"; message: string };

/** The outcome of a file the reply has none for, so it never reads as done. */
const MISSING: Failed = { status: "failed", message: "no result came back" };

/** The outcomes `call` resolves to; a rejection means nothing was attempted, so each of the `count` files failed. */
const attempt = <O>(call: Promise<O[]>, count: number): Promise<(O | Failed)[]> =>
    call.catch((error: unknown) =>
        Array.from({ length: count }, (): Failed => ({ status: "failed", message: String(error) })),
    );

/** Move `items` to the Trash or delete them from disk, in `mode`, and settle each in the order given. */
export const removeFiles = async <K>(mode: DeletionMode, items: readonly Removable<K>[]): Promise<Settled<K>> => {
    const identities = items.map(({ identity }) => identity);
    const outcomes = await attempt<TrashOutcome | DeleteOutcome>(
        mode === "trash" ? trashMedia(identities) : deleteMedia(identities),
        items.length,
    );

    const settled: Settled<K> = { done: [], failed: [] };
    items.forEach(({ key }, index) => {
        const outcome = outcomes[index] ?? MISSING;
        if (outcome.status === "failed") settled.failed.push({ key, message: outcome.message });
        else settled.done.push(key);
    });
    return settled;
};

/**
 * Put `items`, moved to the Trash, back where they were, and settle each in the order given. A restored file can come
 * back under a new identity, which `identities` gives for each key restored.
 */
export const restoreFiles = async <K>(
    items: readonly Removable<K>[],
): Promise<Settled<K> & { identities: Map<K, string> }> => {
    const outcomes = await attempt(restoreMedia(items.map(({ identity }) => identity)), items.length);

    const settled: Settled<K> & { identities: Map<K, string> } = { done: [], failed: [], identities: new Map() };
    items.forEach(({ key }, index) => {
        const outcome = outcomes[index] ?? MISSING;
        if (outcome.status === "restored") {
            settled.done.push(key);
            settled.identities.set(key, outcome.identity);
        } else {
            settled.failed.push({ key, message: outcome.message });
        }
    });
    return settled;
};
