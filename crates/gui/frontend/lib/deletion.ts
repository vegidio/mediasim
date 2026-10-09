import { type DeleteOutcome, deleteMedia, restoreMedia, type TrashOutcome, trashMedia } from "@/ipc/trash";
import type { DeletionMode } from "@/stores/settings";

/** The deletion button's label for `count` files: "Move N to Trash" or "Delete N permanently", with "…" to confirm. */
export const deletionLabel = (mode: DeletionMode, confirm: boolean, count: number) =>
    `${mode === "trash" ? `Move ${count} to Trash` : `Delete ${count} permanently`}${confirm ? "…" : ""}`;

/** A file to remove or restore: the caller's key for it, and the identity it is admitted as. */
export type Removable<K> = { key: K; identity: string };

/** How a removal or a restore went: the keys of the files it was done to, and each one it wasn't with the reason. */
export type Settled<K> = { done: K[]; failed: { key: K; message: string }[] };

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
