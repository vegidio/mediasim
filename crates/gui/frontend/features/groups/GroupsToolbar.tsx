import { ArrowLeftIcon, HouseIcon, LayoutGridIcon, type LucideIcon, Rows2Icon, SparklesIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { Button } from "@/components/ui/button";
import { focusCompare } from "@/features/gallery/GalleryToolbar";
import { focusContinue } from "@/features/home/SetCard";
import { cn, keepFocus } from "@/lib/utils";
import type { GroupsLayout } from "@/stores/groupsView";
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
    /** How the groups are laid out, which the layout toggle shows selected. */
    layout: GroupsLayout;
    /** Switches the groups to `layout`. */
    onLayoutChange: (layout: GroupsLayout) => void;
    /** Shows the Auto-select split button faded, with both its halves disabled, as when no group is left. */
    autoSelectDisabled?: boolean;
};

/** The layouts the toggle offers, in its order. */
const LAYOUTS = [
    { value: "cards", label: "Cards", Icon: LayoutGridIcon },
    { value: "list", label: "List", Icon: Rows2Icon },
] as const satisfies readonly { value: GroupsLayout; label: string; Icon: LucideIcon }[];

const isGroupsLayout = (value: string): value is GroupsLayout => LAYOUTS.some((layout) => layout.value === value);

/** The segmented toggle between the cards and list layouts of the groups. */
const LayoutToggle = ({ layout, onChange }: { layout: GroupsLayout; onChange: (layout: GroupsLayout) => void }) => (
    <ToggleGroup.Root
        type="single"
        value={layout}
        // A click on the selected layout sends an empty value, which leaves it selected.
        onValueChange={(value) => isGroupsLayout(value) && onChange(value)}
        aria-label="Group layout"
        className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface-sunken p-[3px]"
    >
        {LAYOUTS.map(({ value, label, Icon }) => (
            <ToggleGroup.Item
                key={value}
                value={value}
                aria-label={label}
                title={label}
                onMouseDown={keepFocus}
                className="flex h-7 w-8 items-center justify-center rounded-md text-text-disabled outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=on]:bg-border data-[state=on]:text-foreground"
            >
                <Icon aria-hidden="true" className="size-[15px]" />
            </ToggleGroup.Item>
        ))}
    </ToggleGroup.Root>
);

type GroupsToolbarProps = {
    summary: string;
    /** Clear marks and the Auto-select split button, when given. */
    marking?: GroupsMarking;
};

/**
 * Above the groups: Back to the gallery, New comparison, the summary of what the scan found, then the layout toggle,
 * Clear marks and the Auto-select split button, with its chevron of other options, while there is something to mark.
 */
export const GroupsToolbar = ({ summary, marking }: GroupsToolbarProps) => {
    const leave = useScanStore((state) => state.leave);
    const newComparison = useNewComparison();

    return (
        <div className="flex h-[68px] shrink-0 items-center gap-5 border-border-subtle border-b px-6">
            <Button
                variant="outline"
                onClick={() => {
                    leave();
                    focusCompare();
                }}
                className="h-9 shrink-0 gap-1.5 rounded-lg border-border bg-transparent pr-3 pl-2 text-text-label text-sm dark:border-border dark:bg-transparent [&_svg:not([class*='size-'])]:size-4"
            >
                <ArrowLeftIcon aria-hidden="true" />
                Back
            </Button>
            <Button
                variant="ghost"
                onClick={newComparison}
                className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-muted-foreground text-sm [&_svg:not([class*='size-'])]:size-[15px]"
            >
                <HouseIcon aria-hidden="true" />
                New comparison
            </Button>
            <span aria-hidden="true" className="h-7 w-px shrink-0 bg-border" />
            <span title={summary} className="min-w-0 flex-1 truncate text-muted-foreground text-[13px]">
                {summary}
            </span>
            {marking && (
                <>
                    <LayoutToggle layout={marking.layout} onChange={marking.onLayoutChange} />
                    <Button
                        variant="ghost"
                        onClick={marking.onClear}
                        onMouseDown={keepFocus}
                        className="h-[38px] shrink-0 rounded-lg px-3.5 font-medium text-muted-foreground text-sm"
                    >
                        Clear marks
                    </Button>
                    <div className={cn("inline-flex shrink-0", marking.autoSelectDisabled && "opacity-40")}>
                        <Button
                            disabled={marking.autoSelectDisabled}
                            onClick={marking.onAutoSelect}
                            onMouseDown={keepFocus}
                            className="h-[38px] gap-2 rounded-lg rounded-r-none px-4 font-semibold text-primary-foreground text-sm hover:bg-primary/90 disabled:bg-primary disabled:text-primary-foreground [&_svg:not([class*='size-'])]:size-4"
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
