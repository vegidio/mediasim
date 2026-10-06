import { Trash2Icon } from "lucide-react";
import type { Slot } from "@/features/start/routePairDrop";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import type { GoneKind } from "@/stores/pairResult";
import { DetailsTable } from "./DetailsTable";
import type { Details } from "./details";
import { MarkButton } from "./MarkButton";
import { SliderStage } from "./SliderStage";

type SliderPaneProps = {
    files: Record<Slot, MediaFile>;
    details: Record<Slot, Details>;
    /** The share of the stage showing A, from 0 to 100. */
    position: number;
    onPositionChange: (position: number) => void;
    /** Which files are marked for deletion. */
    marked: Record<Slot, boolean>;
    onToggleMark: (slot: Slot) => void;
    /** How each file that has left went; neither by default. */
    gone?: Partial<Record<Slot, GoneKind>>;
};

const Badge = ({ slot, gone }: { slot: Slot; gone: boolean }) => (
    <span
        className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md font-semibold text-xs",
            gone ? "border border-[#3F3F46] border-dashed bg-[#18181B] text-text-disabled" : "bg-secondary",
        )}
    >
        {slot.toUpperCase()}
    </span>
);

const Name = ({ file, gone }: { file: MediaFile; gone: boolean }) => (
    <span
        title={file.name}
        className={cn("min-w-0 truncate font-mono text-[13px]", gone && "text-text-disabled line-through")}
    >
        {file.name}
    </span>
);

/** Stands in for a gone file's mark button, saying how it went: there is nothing left to mark. */
const GonePill = ({ gone }: { gone: GoneKind }) => (
    <span className="flex h-[22px] shrink-0 items-center gap-1 rounded-full border border-[#3F3F46] bg-[#18181B] px-2 font-medium text-[#A1A1AA] text-[11px]">
        <Trash2Icon aria-hidden="true" className="size-[11px]" />
        {gone === "trash" ? "In Trash" : "Deleted"}
    </span>
);

const NONE_GONE: Partial<Record<Slot, GoneKind>> = {};

/** A file's mark button, or the "In Trash" or "Deleted" pill once it is gone. */
const Mark = ({
    slot,
    marked,
    gone,
    onToggleMark,
}: Pick<SliderPaneProps, "marked" | "onToggleMark"> & { slot: Slot; gone: Partial<Record<Slot, GoneKind>> }) => {
    const kind = gone[slot];

    return kind ? (
        <GonePill gone={kind} />
    ) : (
        <MarkButton slot={slot} marked={marked[slot]} onToggle={() => onToggleMark(slot)} variant="slider" />
    );
};

/**
 * Both files of the pair in one pane: their mark buttons beside their names, A over B under a slider, then their
 * details side by side in a table.
 */
export const SliderPane = ({
    files,
    details,
    position,
    onPositionChange,
    marked,
    onToggleMark,
    gone = NONE_GONE,
}: SliderPaneProps) => (
    <article
        aria-label="Files A and B"
        // No background of its own: the stage draws its own dots, matched by A's layer; only the bars are cards.
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border"
    >
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-border border-b bg-card px-4">
            <Badge slot="a" gone={gone.a !== undefined} />
            <Name file={files.a} gone={gone.a !== undefined} />
            <Mark slot="a" marked={marked} gone={gone} onToggleMark={onToggleMark} />
            <span className="flex-1" />
            <Mark slot="b" marked={marked} gone={gone} onToggleMark={onToggleMark} />
            <Name file={files.b} gone={gone.b !== undefined} />
            <Badge slot="b" gone={gone.b !== undefined} />
        </div>

        <SliderStage
            a={files.a}
            b={files.b}
            position={position}
            onPositionChange={onPositionChange}
            marked={marked}
            gone={gone}
        />

        <DetailsTable files={files} details={details} gone={gone} />
    </article>
);
