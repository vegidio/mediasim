import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Slot } from "@/lib/slots";
import { cn } from "@/lib/utils";

type MarkButtonProps = {
    slot: Slot;
    marked: boolean;
    onToggle: () => void;
    /** `slider` names the file in the visible text, since its two buttons share one header. */
    variant: "pane" | "slider";
};

/**
 * Marks a file for deletion, or undoes the mark. No `aria-pressed`: the label already changes with the state, and the
 * two together would be announced as contradictory. The badge letter is in every name, hidden where it isn't shown, so
 * the two buttons can be told apart.
 */
export const MarkButton = ({ slot, marked, onToggle, variant }: MarkButtonProps) => {
    const badge = slot.toUpperCase();

    return (
        <Button
            variant="outline"
            onClick={onToggle}
            className={cn(
                "h-8 gap-1.5 rounded-lg px-2.5 font-medium text-danger-soft text-[13px] hover:text-danger-soft [&_svg:not([class*='size-'])]:size-3.5",
                marked
                    ? "border-danger bg-[rgba(220,38,38,.16)] hover:bg-[rgba(220,38,38,.24)] dark:border-danger dark:bg-[rgba(220,38,38,.16)] dark:enabled:hover:bg-[rgba(220,38,38,.24)]"
                    : "border-danger-border bg-transparent hover:bg-[rgba(220,38,38,.08)] dark:border-danger-border dark:bg-transparent dark:enabled:hover:bg-[rgba(220,38,38,.08)]",
            )}
        >
            <Trash2Icon aria-hidden="true" />
            {marked ? (
                <span>
                    <span className="sr-only">{badge}</span> Marked · Undo
                </span>
            ) : (
                <span>
                    Mark <span className={cn(variant === "pane" && "sr-only")}>{badge}</span> for deletion
                </span>
            )}
        </Button>
    );
};
