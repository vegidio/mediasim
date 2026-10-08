import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { focusCompare } from "@/features/gallery/GalleryToolbar";
import { formatUnreadable } from "@/features/scan/format";
import { useScanStore } from "@/stores/scan";

/** "N similar groups found", "1 similar group found", or "No similar files found" when there is none. */
export const groupsHeading = (count: number) =>
    count === 0 ? "No similar files found" : `${count} similar ${count === 1 ? "group" : "groups"} found`;

/**
 * Where a finished scan leads: for now, how many groups it found and how many files it couldn't read, with Back to the
 * gallery. The groups themselves are shown by a later change.
 */
export const GroupsScreen = () => {
    const groups = useScanStore((state) => state.result?.groups.length ?? 0);
    const skipped = useScanStore((state) => state.result?.skipped.length ?? 0);
    const leave = useScanStore((state) => state.leave);

    return (
        <div className="m-auto flex w-full max-w-[680px] flex-col items-start gap-6">
            <div className="flex flex-col gap-2">
                <h1 className="font-semibold text-[32px] tracking-[-0.02em]">{groupsHeading(groups)}</h1>
                {skipped > 0 && <p className="text-[#A1A1AA] text-[15px]">{formatUnreadable(skipped)}</p>}
            </div>
            <Button
                variant="outline"
                onClick={() => {
                    leave();
                    focusCompare();
                }}
                className="h-10 gap-1.5 rounded-lg border-[#3F3F46] bg-transparent pr-4 pl-3 text-sm dark:border-[#3F3F46] dark:bg-transparent [&_svg:not([class*='size-'])]:size-4"
            >
                <ArrowLeftIcon aria-hidden="true" />
                Back
            </Button>
        </div>
    );
};
