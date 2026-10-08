import { ArrowLeftIcon, HouseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { focusCompare } from "@/features/gallery/GalleryToolbar";
import { focusContinue } from "@/features/home/SetCard";
import { useScanStore } from "@/stores/scan";

/** Forget the scan and show the Home screen with the set unchanged, with focus on its Continue button. */
export const useNewComparison = () => {
    const newComparison = useScanStore((state) => state.newComparison);

    return () => {
        newComparison();
        focusContinue();
    };
};

/** Above the groups: Back to the gallery, New comparison, and the summary of what the scan found. */
export const GroupsToolbar = ({ summary }: { summary: string }) => {
    const leave = useScanStore((state) => state.leave);
    const newComparison = useNewComparison();

    return (
        <div className="flex h-[68px] shrink-0 items-center gap-5 border-[#1F1F23] border-b px-6">
            <Button
                variant="outline"
                onClick={() => {
                    leave();
                    focusCompare();
                }}
                className="h-9 shrink-0 gap-1.5 rounded-lg border-[#27272A] bg-transparent pr-3 pl-2 text-[#E4E4E7] text-sm dark:border-[#27272A] dark:bg-transparent [&_svg:not([class*='size-'])]:size-4"
            >
                <ArrowLeftIcon aria-hidden="true" />
                Back
            </Button>
            <Button
                variant="ghost"
                onClick={newComparison}
                className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-[#A1A1AA] text-sm [&_svg:not([class*='size-'])]:size-[15px]"
            >
                <HouseIcon aria-hidden="true" />
                New comparison
            </Button>
            <span aria-hidden="true" className="h-7 w-px shrink-0 bg-[#27272A]" />
            <span title={summary} className="min-w-0 flex-1 truncate text-[#A1A1AA] text-[13px]">
                {summary}
            </span>
        </div>
    );
};
