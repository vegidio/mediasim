import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GroupFile } from "@/ipc/scan";
import { deletionLabel } from "@/lib/deletion";
import { formatCount, formatSize, totalSize } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings";

/**
 * The bar along the bottom of the groups screen: how many files are marked for deletion, the space they would free,
 * and the button that will remove them in the deletion mode the settings choose.
 */
export const GroupsFooter = ({ marked }: { marked: readonly GroupFile[] }) => {
    const mode = useSettingsStore((state) => state.deletionMode);
    const confirm = useSettingsStore((state) => state.confirmDeletion);

    const count = marked.length;

    return (
        <section
            aria-label="Deletion"
            className="flex h-[68px] shrink-0 items-center gap-3.5 border-[#27272A] border-t bg-[#0C0C0E] px-6"
        >
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[rgba(220,38,38,.14)]">
                <Trash2Icon aria-hidden="true" className="size-4 text-[#F87171]" />
            </span>

            {/* Announced on every change, so a mark is confirmed. */}
            <p role="status" className="min-w-0 flex-1 truncate text-sm">
                {count === 0 ? (
                    <span className="text-[#A1A1AA]">
                        Nothing marked yet. Tick files, or let Auto-select pick the extras for you.
                    </span>
                ) : (
                    <>
                        <span className="font-semibold">{formatCount(count)}</span> marked for deletion
                        <span className="text-[#A1A1AA]"> · {formatSize(totalSize(marked))} will be freed</span>
                    </>
                )}
            </p>

            {/* Inert until moving files from a group, with its confirmation and result, is built. */}
            <Button
                disabled={count === 0}
                className="h-10 rounded-lg bg-[#DC2626] px-[18px] font-semibold text-sm text-white hover:bg-[#B91C1C] disabled:bg-[#27272A] disabled:text-[#71717A]"
            >
                {deletionLabel(mode, confirm, count)}
            </Button>
        </section>
    );
};
