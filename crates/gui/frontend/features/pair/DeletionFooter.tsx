import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { deletionLabel } from "@/lib/deletion";
import { formatCount, formatSize, totalSize } from "@/lib/format";
import { selectMarkedFiles, usePairResultStore } from "@/stores/pairResult";
import { useSettingsStore } from "@/stores/settings";
import { ConfirmDeletionDialog } from "./ConfirmDeletionDialog";
import { focusDismiss } from "./DeletionNotice";

/**
 * The bar along the bottom of the pair result screen: what is marked for deletion, the space it frees, and the button
 * that removes it in the deletion mode the settings choose, after a confirmation while the settings ask for one.
 */
export const DeletionFooter = () => {
    const chosen = usePairResultStore(useShallow(selectMarkedFiles));
    const gone = usePairResultStore((state) => state.gone);
    const deletion = usePairResultStore((state) => state.deletion);
    const requestDeletion = usePairResultStore((state) => state.requestDeletion);
    const mode = useSettingsStore((state) => state.deletionMode);
    const confirm = useSettingsStore((state) => state.confirmDeletion);

    const count = chosen.length;
    // A run started without confirmation shows here, as the dialog isn't there to show it.
    const running = deletion.status === "removing" && !deletion.confirmed ? deletion.mode : undefined;
    const label = deletionLabel(mode, confirm, count);

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
                    gone.a || gone.b ? (
                        "Nothing marked for deletion."
                    ) : (
                        "Nothing marked yet. Mark the file you don't need."
                    )
                ) : (
                    <>
                        <span className="font-semibold">{formatCount(count)}</span> marked for deletion
                        <span className="text-[#A1A1AA]"> · {formatSize(totalSize(chosen))} will be freed</span>
                    </>
                )}
            </p>

            <ConfirmDeletionDialog>
                <Button
                    disabled={count === 0 || running !== undefined}
                    onClick={(event) => {
                        if (useSettingsStore.getState().confirmDeletion) return;
                        // Keeps the dialog shut and runs at once. The button is disabled by the time the run ends, so
                        // focus goes to the notice reporting it.
                        event.preventDefault();
                        // Nothing starts while a restore runs, so focus stays on the button.
                        if (usePairResultStore.getState().deletion.status !== "idle") return;
                        void requestDeletion().then(focusDismiss);
                    }}
                    className={
                        running
                            ? "h-10 gap-2 rounded-lg px-[18px] font-semibold text-sm disabled:bg-[#DC2626] disabled:text-white disabled:opacity-60"
                            : "h-10 rounded-lg bg-[#DC2626] px-[18px] font-semibold text-sm text-white hover:bg-[#B91C1C] disabled:bg-[#27272A] disabled:text-[#71717A]"
                    }
                >
                    {running && (
                        <LoaderCircleIcon
                            aria-hidden="true"
                            className="size-4 animate-spin motion-reduce:animate-none"
                        />
                    )}
                    {running === "trash" ? "Moving…" : running === "permanent" ? "Deleting…" : label}
                </Button>
            </ConfirmDeletionDialog>
        </section>
    );
};
