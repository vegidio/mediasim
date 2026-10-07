import type { Slot } from "@/features/start/routePairDrop";
import { cn } from "@/lib/utils";

/** A file's slot letter, A or B, in a small square; dashed and dimmed once the file is `gone`. */
export const SlotBadge = ({ slot, gone = false }: { slot: Slot; gone?: boolean }) => (
    <span
        className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md font-semibold text-xs",
            gone ? "border border-[#3F3F46] border-dashed bg-[#18181B] text-text-disabled" : "bg-secondary",
        )}
    >
        {slot.toUpperCase()}
    </span>
);
