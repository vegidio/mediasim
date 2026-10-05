import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Slot } from "@/features/start/routePairDrop";
import { formatSize } from "@/lib/format";
import { usePairResultStore } from "@/stores/pairResult";

const SLOTS: Slot[] = ["a", "b"];

/**
 * The bar along the bottom of the pair result screen: what is marked for deletion, the space it frees, and the button
 * that will move it to the Trash. The button does nothing yet.
 */
export const DeletionFooter = () => {
    const files = usePairResultStore((state) => state.files);
    const marked = usePairResultStore((state) => state.marked);

    const chosen = files ? SLOTS.filter((slot) => marked[slot]).map((slot) => files[slot]) : [];
    const count = chosen.length;
    const freed = chosen.reduce((total, file) => total + file.size, 0);

    return (
        <section
            aria-label="Deletion"
            className="flex h-[68px] shrink-0 items-center gap-3.5 border-border border-t bg-surface-sunken px-10"
        >
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[rgba(220,38,38,.14)]">
                <Trash2Icon aria-hidden="true" className="size-4 text-[#F87171]" />
            </span>

            {/* Announced on every change, so a mark or an undo is confirmed. */}
            <p role="status" className="min-w-0 flex-1 truncate text-sm">
                {count === 0 ? (
                    "Nothing marked yet. Mark the file you don't need."
                ) : (
                    <>
                        <span className="font-semibold">{count === 1 ? "1 file" : `${count} files`}</span> marked for
                        deletion<span className="text-[#A1A1AA]"> · {formatSize(freed)} will be freed</span>
                    </>
                )}
            </p>

            {/* Inert in this slice; the next one opens the confirmation from here. */}
            <Button
                disabled={count === 0}
                onClick={() => {}}
                className="h-10 rounded-lg bg-[#DC2626] px-[18px] font-semibold text-sm text-white hover:bg-[#B91C1C] disabled:bg-[#27272A] disabled:text-[#71717A]"
            >
                Move {count} to Trash…
            </Button>
        </section>
    );
};
