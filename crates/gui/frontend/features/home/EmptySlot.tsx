import { type Ref, useId } from "react";
import { UploadIcon } from "lucide-react";
import { dropTargetClassName } from "@/features/home/ModeCard";
import { pickFile } from "@/ipc/dialog";
import { supportedFormats } from "@/ipc/formats";
import type { Slot } from "@/lib/slots";
import { cn } from "@/lib/utils";
import { usePairStore } from "@/stores/pair";

/** The label of each slot, as the card shows it. */
export const slotLabel = (slot: Slot) => (slot === "a" ? "File A" : "File B");

/** Pick one media file, filtered to what `mediasim` loads, and place it in `slot`; a cancelled picker places nothing. */
const pickInto = async (slot: Slot) => {
    try {
        const path = await supportedFormats().then(pickFile);
        if (path) await usePairStore.getState().place(slot, path);
    } catch (error) {
        console.error("could not open the picker", error);
    }
};

type EmptySlotProps = {
    slot: Slot;
    /** The slot's button, which gets focus back when the slot's file is removed. */
    ref?: Ref<HTMLButtonElement>;
    /** Whether a drag over the card would fill this slot. */
    highlighted?: boolean;
};

/** A slot with no file: a drop target that opens the picker when activated. */
export const EmptySlot = ({ slot, ref, highlighted = false }: EmptySlotProps) => {
    const labelId = useId();
    const hintId = useId();

    return (
        <button
            ref={ref}
            type="button"
            aria-labelledby={labelId}
            aria-describedby={hintId}
            onClick={() => pickInto(slot)}
            className={cn(
                dropTargetClassName,
                "h-[210px] w-full cursor-pointer outline-none transition-colors hover:border-border-hover focus-visible:ring-3 focus-visible:ring-ring/50",
                highlighted && "border-border-hover bg-card",
            )}
        >
            <UploadIcon aria-hidden="true" />
            <span id={labelId} className="font-medium text-foreground text-sm">
                {slotLabel(slot)}
            </span>
            <span id={hintId}>Drop or click to choose</span>
        </button>
    );
};
