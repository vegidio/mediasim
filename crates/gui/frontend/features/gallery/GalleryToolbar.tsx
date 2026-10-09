import { useId } from "react";
import { ArrowLeftIcon, ArrowRightIcon, FolderIcon, ImagesIcon } from "lucide-react";
import { ThresholdSlider } from "@/components/ThresholdSlider";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { focusContinue } from "@/features/home/SetCard";
import { compareCount, compareState, type FilterCounts, filterCounts, identity } from "@/lib/gallery";
import { focusById } from "@/lib/utils";
import { type GalleryFilter, useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScanStore } from "@/stores/scan";
import { useScreenStore } from "@/stores/screen";
import { ComparisonOptionsMenu } from "./ComparisonOptionsMenu";

/** The Compare button's id, which focus is sent to on coming back from a comparison. */
const COMPARE_BUTTON_ID = "gallery-compare";

/** Move focus to the gallery's Compare button, once React has rendered the gallery just shown. */
export const focusCompare = () => focusById(COMPARE_BUTTON_ID);

/** The filter tabs, in the order the toolbar shows them. */
const FILTERS: { value: GalleryFilter; label: string }[] = [
    { value: "images", label: "Images" },
    { value: "videos", label: "Videos" },
    { value: "both", label: "Both" },
];

/** The files as read, or `undefined` while they are being read or couldn't be. */
const useFiles = () => useGalleryStore((state) => (state.listing.status === "ready" ? state.listing.files : undefined));

/** Back to the Home screen, with focus on its Continue button. */
const BackButton = () => {
    const show = useScreenStore((state) => state.show);

    return (
        <Button
            variant="outline"
            onClick={() => {
                show("home");
                focusContinue();
            }}
            className="h-9 gap-1.5 rounded-lg border-border bg-transparent pr-3 pl-2 text-text-label text-sm dark:border-border dark:bg-transparent [&_svg:not([class*='size-'])]:size-4"
        >
            <ArrowLeftIcon aria-hidden="true" />
            Back
        </Button>
    );
};

/** What the set is: one folder by its name and path, or a group of files by their count and locations. */
const IdentityBlock = () => {
    const sources = useHomeStore((state) => state.view.sources);
    const total = useHomeStore((state) => state.view.total);
    const { kind, title, details } = identity(sources, total, useFiles());
    const Icon = kind === "folder" ? FolderIcon : ImagesIcon;

    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                <Icon aria-hidden="true" className="size-[18px]" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-semibold text-[15px]">{title}</span>
                <span title={details} className="truncate font-mono text-muted-foreground text-xs">
                    {details}
                </span>
            </div>
        </div>
    );
};

/**
 * Images, Videos and Both, each with its count once the files are read. A click on one hands keyboard focus back to the
 * grid, so the arrow keys go on moving the selection; reached from the keyboard, the tabs keep their arrow keys.
 */
const FilterTabs = ({ counts }: { counts?: FilterCounts }) => {
    const returnToGrid = useGalleryStore((state) => state.returnToGrid);

    return (
        <TabsList aria-label="Filter media" className="h-auto rounded-[9px] border-border bg-muted">
            {FILTERS.map(({ value, label }) => (
                // A click from Enter or Space has no pointer press, and so a `detail` of 0.
                <TabsTrigger
                    key={value}
                    value={value}
                    onClick={(event) => event.detail > 0 && returnToGrid()}
                    className="flex-none"
                >
                    {label}
                    {/* A space, so the name reads "Images 36"; a flex container doesn't render it. */}
                    {counts && " "}
                    {counts && <span className="font-mono text-muted-foreground text-[11px]">{counts[value]}</span>}
                </TabsTrigger>
            ))}
        </TabsList>
    );
};

/** The session's match threshold: a slider in whole percent, with its value beside it. */
const ThresholdControl = () => {
    const threshold = useGalleryStore((state) => state.threshold);
    const setThreshold = useGalleryStore((state) => state.setThreshold);
    const labelId = useId();

    return (
        <div className="flex items-center gap-2.5">
            <span id={labelId} className="whitespace-nowrap text-muted-foreground text-[13px]">
                Match threshold
            </span>
            <ThresholdSlider
                aria-labelledby={labelId}
                value={threshold}
                onChange={setThreshold}
                className="w-[120px]"
            />
            <span className="w-9 font-mono text-[13px]">{threshold}%</span>
        </div>
    );
};

/**
 * Compare and its options chevron, joined. Compare starts the comparison of the included files; the chevron opens the
 * comparison options, whatever the count.
 */
const CompareButton = ({ count }: { count?: number }) => {
    const { label, enabled } = compareState(count);

    return (
        <div className="flex shrink-0 items-center">
            <Button
                id={COMPARE_BUTTON_ID}
                disabled={!enabled}
                onClick={() => useScanStore.getState().start()}
                className="h-[38px] gap-2 rounded-r-none px-4 font-semibold text-primary-foreground text-sm hover:bg-primary/90"
            >
                {label}
                <ArrowRightIcon aria-hidden="true" />
            </Button>
            <ComparisonOptionsMenu />
        </div>
    );
};

/** The gallery's toolbar: Back and what the set is, the filter tabs, then the threshold and Compare. */
export const GalleryToolbar = () => {
    const filter = useGalleryStore((state) => state.filter);
    const overrides = useGalleryStore((state) => state.overrides);
    const files = useFiles();
    const counts = files && filterCounts(files);

    return (
        <div className="grid h-[72px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 border-border-subtle border-b px-6">
            <div className="flex min-w-0 items-center gap-3">
                <BackButton />
                <span aria-hidden="true" className="h-7 w-px shrink-0 bg-border" />
                <IdentityBlock />
            </div>
            <FilterTabs {...(counts && { counts })} />
            <div className="flex items-center justify-end gap-5">
                <ThresholdControl />
                <CompareButton {...(files && { count: compareCount(files, filter, overrides) })} />
            </div>
        </div>
    );
};
