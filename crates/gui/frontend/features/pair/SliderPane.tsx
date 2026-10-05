import type { Slot } from "@/features/start/routePairDrop";
import type { MediaFile } from "@/ipc/thumbs";
import { DetailsTable } from "./DetailsTable";
import type { Details } from "./details";
import { SliderStage } from "./SliderStage";

type SliderPaneProps = {
    files: Record<Slot, MediaFile>;
    details: Record<Slot, Details>;
    /** The share of the stage showing A, from 0 to 100. */
    position: number;
    onPositionChange: (position: number) => void;
};

const Badge = ({ slot }: { slot: Slot }) => (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary font-semibold text-xs">
        {slot.toUpperCase()}
    </span>
);

const Name = ({ file }: { file: MediaFile }) => (
    <span title={file.name} className="min-w-0 truncate font-mono text-[13px]">
        {file.name}
    </span>
);

/** Both files of the pair in one pane: A over B under a slider, then their details side by side in a table. */
export const SliderPane = ({ files, details, position, onPositionChange }: SliderPaneProps) => (
    <article
        aria-label="Files A and B"
        // No background of its own: the stage draws its own dots, matched by A's layer; only the bars are cards.
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border"
    >
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-border border-b bg-card px-4">
            <Badge slot="a" />
            <Name file={files.a} />
            <span className="flex-1" />
            <Name file={files.b} />
            <Badge slot="b" />
        </div>

        <SliderStage a={files.a} b={files.b} position={position} onPositionChange={onPositionChange} />

        <DetailsTable files={files} details={details} />
    </article>
);
