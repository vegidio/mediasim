import type { ReactNode } from "react";
import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Deletion, deletionLabel } from "@/lib/deletion";
import { formatCount, formatSize, totalSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { focusDismiss } from "./DeletionNotice";

type DeletionFooterProps = {
    /** The files marked for deletion. */
    marked: readonly { size: number }[];
    /** Whether any file has been removed, which says nothing is marked for deletion rather than nothing yet. */
    anyGone: boolean;
    /** What the footer says while nothing is marked yet. */
    emptyHint: string;
    deletion: Deletion;
    requestDeletion: () => Promise<void>;
    /** Whether the button is disabled on top of nothing being marked and a removal running. */
    disabled?: boolean;
    /** Wraps the button in the deletion dialog it opens. */
    dialog: (button: ReactNode) => ReactNode;
    /** The bar's border, background and padding. */
    className: string;
    /** The class of the line said while nothing is marked. */
    hintClassName?: string;
};

/**
 * The bar along the bottom of a screen that deletes: what is marked for deletion, the space it frees, and the button
 * that removes it in the deletion mode the settings choose, after a confirmation while the settings ask for one.
 */
export const DeletionFooter = ({
    marked,
    anyGone,
    emptyHint,
    deletion,
    requestDeletion,
    disabled,
    dialog,
    className,
    hintClassName,
}: DeletionFooterProps) => {
    const mode = useSettingsStore((state) => state.deletionMode);
    const confirm = useSettingsStore((state) => state.confirmDeletion);

    const count = marked.length;
    // A run started without confirmation shows here, as the dialog isn't there to show it.
    const running = deletion.status === "removing" && !deletion.confirmed ? deletion.mode : undefined;

    return (
        <section
            aria-label="Deletion"
            className={cn("flex h-[68px] shrink-0 items-center gap-3.5 border-t", className)}
        >
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[rgba(220,38,38,.14)]">
                <Trash2Icon aria-hidden="true" className="size-4 text-danger-bright" />
            </span>

            {/* Announced on every change, so a mark or an undo is confirmed. */}
            <p role="status" className="min-w-0 flex-1 truncate text-sm">
                {count === 0 ? (
                    <span className={hintClassName}>{anyGone ? "Nothing marked for deletion." : emptyHint}</span>
                ) : (
                    <>
                        <span className="font-semibold">{formatCount(count)}</span> marked for deletion
                        <span className="text-muted-foreground"> · {formatSize(totalSize(marked))} will be freed</span>
                    </>
                )}
            </p>

            {dialog(
                <Button
                    disabled={count === 0 || !!running || disabled}
                    onClick={(event) => {
                        if (useSettingsStore.getState().confirmDeletion) return;
                        // Keeps the dialog shut and runs at once. The button is disabled by the time the run ends, so
                        // focus goes to the notice reporting it.
                        event.preventDefault();
                        // Nothing starts while a restore runs, so focus stays on the button.
                        if (deletion.status !== "idle") return;
                        void requestDeletion().then(focusDismiss);
                    }}
                    className={
                        running
                            ? "h-10 gap-2 rounded-lg px-[18px] font-semibold text-sm disabled:bg-danger disabled:text-white disabled:opacity-60"
                            : "h-10 rounded-lg bg-danger px-[18px] font-semibold text-sm text-white hover:bg-danger-hover disabled:bg-border disabled:text-text-disabled"
                    }
                >
                    {running && (
                        <LoaderCircleIcon
                            aria-hidden="true"
                            className="size-4 animate-spin motion-reduce:animate-none"
                        />
                    )}
                    {running === "trash"
                        ? "Moving…"
                        : running === "permanent"
                          ? "Deleting…"
                          : deletionLabel(mode, confirm, count)}
                </Button>,
            )}
        </section>
    );
};
