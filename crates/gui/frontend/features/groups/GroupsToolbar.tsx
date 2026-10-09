import { ArrowLeftIcon, HouseIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { focusCompare } from "@/features/gallery/GalleryToolbar";
import { focusContinue } from "@/features/home/SetCard";
import { cn, keepFocus } from "@/lib/utils";
import { useScanStore } from "@/stores/scan";
import { AutoSelectMenu } from "./AutoSelectMenu";

/** Forget the scan and show the Home screen with the set unchanged, with focus on its Continue button. */
export const useNewComparison = () => {
    const newComparison = useScanStore((state) => state.newComparison);

    return () => {
        newComparison();
        focusContinue();
    };
};

/** The toolbar's marking buttons, shown while there is a group to mark files in. */
export type GroupsMarking = {
    /** Unmarks every file. */
    onClear: () => void;
    /** Marks every file but its group's best, and unmarks the best files. */
    onAutoSelect: () => void;
    /** Opens the Auto-select rules dialog. */
    onChooseRules: () => void;
    /** Focuses the selected tile, returning whether there was one. */
    refocus: () => boolean;
    /** Shows the Auto-select split button faded, with both its halves disabled, as when no group is left. */
    autoSelectDisabled?: boolean;
};

type GroupsToolbarProps = {
    summary: string;
    /** Clear marks and the Auto-select split button, when given. */
    marking?: GroupsMarking;
};

/**
 * Above the groups: Back to the gallery, New comparison, the summary of what the scan found, then Clear marks and
 * the Auto-select split button, with its chevron of other options, while there is something to mark.
 */
export const GroupsToolbar = ({ summary, marking }: GroupsToolbarProps) => {
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
            {marking && (
                <>
                    <Button
                        variant="ghost"
                        onClick={marking.onClear}
                        onMouseDown={keepFocus}
                        className="h-[38px] shrink-0 rounded-lg px-3.5 font-medium text-[#A1A1AA] text-sm"
                    >
                        Clear marks
                    </Button>
                    <div className={cn("inline-flex shrink-0", marking.autoSelectDisabled && "opacity-40")}>
                        <Button
                            disabled={marking.autoSelectDisabled}
                            onClick={marking.onAutoSelect}
                            onMouseDown={keepFocus}
                            className="h-[38px] gap-2 rounded-lg rounded-r-none px-4 font-semibold text-[#1A2E05] text-sm hover:bg-[#BEF264]/90 disabled:bg-primary disabled:text-[#1A2E05] [&_svg:not([class*='size-'])]:size-4"
                        >
                            <SparklesIcon aria-hidden="true" />
                            Auto-select
                        </Button>
                        <AutoSelectMenu
                            onChooseRules={marking.onChooseRules}
                            refocus={marking.refocus}
                            {...(marking.autoSelectDisabled && { disabled: true })}
                        />
                    </div>
                </>
            )}
        </div>
    );
};
