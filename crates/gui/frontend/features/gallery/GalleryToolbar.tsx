import { useId } from "react";
import { ArrowLeftIcon, ArrowRightIcon, ChevronDownIcon, FolderIcon, ImagesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { focusContinue } from "@/features/start/SetCard";
import { type GalleryFilter, useGalleryStore } from "@/stores/gallery";
import { useScreenStore } from "@/stores/screen";
import { MATCH_THRESHOLD_MAX, MATCH_THRESHOLD_MIN } from "@/stores/settings";
import { useStartStore } from "@/stores/start";
import { compareState, type FilterCounts, filterCounts, identity } from "./derive";

/** The filter tabs, in the order the toolbar shows them. */
const FILTERS: { value: GalleryFilter; label: string }[] = [
    { value: "images", label: "Images" },
    { value: "videos", label: "Videos" },
    { value: "both", label: "Both" },
];

/** The files as read, or `undefined` while they are being read or couldn't be. */
const useFiles = () => useGalleryStore((state) => (state.listing.status === "ready" ? state.listing.files : undefined));

/** Back to the start screen, with focus on its Continue button. */
const BackButton = () => {
    const show = useScreenStore((state) => state.show);

    return (
        <Button
            variant="outline"
            onClick={() => {
                show("start");
                focusContinue();
            }}
            className="h-9 gap-1.5 rounded-lg border-[#27272A] bg-transparent pr-3 pl-2 text-[#E4E4E7] text-sm dark:border-[#27272A] dark:bg-transparent [&_svg:not([class*='size-'])]:size-4"
        >
            <ArrowLeftIcon aria-hidden="true" />
            Back
        </Button>
    );
};

/** What the set is: one folder by its name and path, or a group of files by their count and locations. */
const IdentityBlock = () => {
    const sources = useStartStore((state) => state.view.sources);
    const total = useStartStore((state) => state.view.total);
    const { kind, title, details } = identity(sources, total, useFiles());
    const Icon = kind === "folder" ? FolderIcon : ImagesIcon;

    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#27272A] bg-[#18181B] text-[#A1A1AA]">
                <Icon aria-hidden="true" className="size-[18px]" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-semibold text-[15px]">{title}</span>
                <span title={details} className="truncate font-mono text-[#A1A1AA] text-xs">
                    {details}
                </span>
            </div>
        </div>
    );
};

/** Images, Videos and Both, each with its count once the files are read. */
const FilterTabs = ({ counts }: { counts?: FilterCounts }) => (
    <TabsList aria-label="Filter media" className="h-auto rounded-[9px] border-[#27272A] bg-[#18181B]">
        {FILTERS.map(({ value, label }) => (
            <TabsTrigger key={value} value={value} className="flex-none">
                {label}
                {/* A space, so the name reads "Images 36"; a flex container doesn't render it. */}
                {counts && " "}
                {counts && <span className="font-mono text-[#A1A1AA] text-[11px]">{counts[value]}</span>}
            </TabsTrigger>
        ))}
    </TabsList>
);

/** The session's match threshold: a slider in whole percent, with its value beside it. */
const ThresholdControl = () => {
    const threshold = useGalleryStore((state) => state.threshold);
    const setThreshold = useGalleryStore((state) => state.setThreshold);
    const labelId = useId();

    return (
        <div className="flex items-center gap-2.5">
            <span id={labelId} className="whitespace-nowrap text-[#A1A1AA] text-[13px]">
                Match threshold
            </span>
            <Slider
                aria-labelledby={labelId}
                min={MATCH_THRESHOLD_MIN}
                max={MATCH_THRESHOLD_MAX}
                step={1}
                value={[threshold]}
                onValueChange={([value]) => value !== undefined && setThreshold(value)}
                className="w-[120px] cursor-pointer"
                trackClassName="bg-[#3F3F46] data-horizontal:h-1"
                rangeClassName="bg-[#BEF264]"
                thumbClassName="size-3.5 border-0 bg-[#BEF264] ring-[#BEF264]/40"
            />
            <span className="w-9 font-mono text-[13px]">{threshold}%</span>
        </div>
    );
};

/** Compare and its options chevron, joined. Neither does anything until the comparison exists. */
const CompareButton = ({ count }: { count?: number }) => {
    const { label, enabled } = compareState(count);

    return (
        <div className="flex shrink-0 items-center">
            <Button
                disabled={!enabled}
                className="h-[38px] gap-2 rounded-r-none px-4 font-semibold text-[#1A2E05] text-sm hover:bg-[#BEF264]/90"
            >
                {label}
                <ArrowRightIcon aria-hidden="true" />
            </Button>
            <Button
                aria-label="Comparison options"
                className="h-[38px] w-9 rounded-l-none border-l-[#65A30D] bg-[#A3E635] p-0 text-[#1A2E05] hover:bg-[#A3E635]/90"
            >
                <ChevronDownIcon aria-hidden="true" />
            </Button>
        </div>
    );
};

/** The gallery's toolbar: Back and what the set is, the filter tabs, then the threshold and Compare. */
export const GalleryToolbar = () => {
    const filter = useGalleryStore((state) => state.filter);
    const files = useFiles();
    const counts = files && filterCounts(files);

    return (
        <div className="grid h-[72px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 border-[#1F1F23] border-b px-6">
            <div className="flex min-w-0 items-center gap-3">
                <BackButton />
                <span aria-hidden="true" className="h-7 w-px shrink-0 bg-[#27272A]" />
                <IdentityBlock />
            </div>
            <FilterTabs {...(counts && { counts })} />
            <div className="flex items-center justify-end gap-5">
                <ThresholdControl />
                <CompareButton {...(counts && { count: counts[filter] })} />
            </div>
        </div>
    );
};
