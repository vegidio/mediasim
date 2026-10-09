/** One of the two slots of the "Compare two files" card. */
export type Slot = "a" | "b";

/** Both slots, A first. */
export const SLOTS: readonly Slot[] = ["a", "b"];

/**
 * The slots a drop onto the pair card fills, in file order: the first file goes to the first slot returned.
 *
 * - No file: none.
 * - Two or more files: A and B, wherever they were dropped; the rest are ignored.
 * - One file onto a slot: that slot, replacing what it holds.
 * - One file onto the card outside the slots: the first empty slot, A before B, or none when both are filled.
 *
 * @param count the number of files that can be placed in a slot.
 * @param filled which slots hold a file.
 * @param target the slot under the drop, absent outside both.
 */
export const route = (count: number, filled: { a: boolean; b: boolean }, target?: Slot): Slot[] => {
    if (count === 0) return [];
    if (count >= 2) return ["a", "b"];
    if (target) return [target];
    if (!filled.a) return ["a"];
    if (!filled.b) return ["b"];
    return [];
};
