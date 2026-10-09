import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { focusDismiss } from "@/components/deletion/DeletionNotice";
import { Button } from "@/components/ui/button";
import type { GroupFile } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { deletionLabel } from "@/lib/deletion";
import { formatCount, formatSize, totalSize } from "@/lib/format";
import { useScanStore } from "@/stores/scan";
import { useSettingsStore } from "@/stores/settings";
import { GroupsDeletionDialog } from "./GroupsDeletionDialog";

type GroupsFooterProps = {
    /** The marked files still shown, in the groups' order and each group's order. */
    marked: readonly GroupFile[];
    /** The scanned files by path. */
    media: ReadonlyMap<string, MediaFile>;
};

/**
 * The bar along the bottom of the groups screen: how many files are marked for deletion, the space they would free,
 * and the button that removes them in the deletion mode the settings choose, after a confirmation while the settings
 * ask for one.
 */
export const GroupsFooter = ({ marked, media }: GroupsFooterProps) => {
    const anyGone = useScanStore((state) => state.gone.size > 0);
    const deletion = useScanStore((state) => state.deletion);
    const requestDeletion = useScanStore((state) => state.requestDeletion);
    const mode = useSettingsStore((state) => state.deletionMode);
    const confirm = useSettingsStore((state) => state.confirmDeletion);

    const count = marked.length;
    // A run started without confirmation shows here, as the dialog isn't there to show it.
    const running = deletion.status === "removing" && !deletion.confirmed ? deletion.mode : undefined;
    const busy = deletion.status === "removing" || deletion.status === "restoring";

    return (
        <section
            aria-label="Deletion"
            className="flex h-[68px] shrink-0 items-center gap-3.5 border-[#27272A] border-t bg-[#0C0C0E] px-6"
        >
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[rgba(220,38,38,.14)]">
                <Trash2Icon aria-hidden="true" className="size-4 text-[#F87171]" />
            </span>

            {/* Announced on every change, so a mark or an undo is confirmed. */}
            <p role="status" className="min-w-0 flex-1 truncate text-sm">
                {count === 0 ? (
                    <span className="text-[#A1A1AA]">
                        {anyGone
                            ? "Nothing marked for deletion."
                            : "Nothing marked yet. Tick files, or let Auto-select pick the extras for you."}
                    </span>
                ) : (
                    <>
                        <span className="font-semibold">{formatCount(count)}</span> marked for deletion
                        <span className="text-[#A1A1AA]"> · {formatSize(totalSize(marked))} will be freed</span>
                    </>
                )}
            </p>

            <GroupsDeletionDialog marked={marked} media={media}>
                <Button
                    disabled={count === 0 || busy}
                    onClick={(event) => {
                        if (useSettingsStore.getState().confirmDeletion) return;
                        // Keeps the dialog shut and runs at once. The button is disabled by the time the run ends, so
                        // focus goes to the notice reporting it.
                        event.preventDefault();
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
                    {running === "trash"
                        ? "Moving…"
                        : running === "permanent"
                          ? "Deleting…"
                          : deletionLabel(mode, confirm, count)}
                </Button>
            </GroupsDeletionDialog>
        </section>
    );
};
