import type { DeletionMode } from "@/stores/settings";

/** The deletion button's label for `count` files: "Move N to Trash" or "Delete N permanently", with "…" to confirm. */
export const deletionLabel = (mode: DeletionMode, confirm: boolean, count: number) =>
    `${mode === "trash" ? `Move ${count} to Trash` : `Delete ${count} permanently`}${confirm ? "…" : ""}`;
