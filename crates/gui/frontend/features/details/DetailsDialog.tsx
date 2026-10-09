import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { DetailsSidebar } from "./DetailsSidebar";
import { DetailsStage } from "./DetailsStage";
import { Filmstrip } from "./Filmstrip";
import { indexOfPath, nextOf, previousOf } from "./navigate";
import { useFileDetails } from "./useFileDetails";

/**
 * How long after opening a click outside is still taken as the second click of the double click that opened it, in
 * milliseconds: the default double-click interval on macOS and Windows.
 */
const DOUBLE_CLICK_MS = 500;

/** The stage's shape before any file's is known. */
const FIRST_RATIO = 4 / 3;

/**
 * The stage's size, from the shown file's `--ratio`: as tall as the window allows 32 px from its edges, around the
 * 52 px title bar, the 116 px filmstrip and the dialog's border (234 px), unless the width runs out first, beside the
 * 340 px sidebar (406 px). Never narrower than the 7-thumbnail strip, 776 px. CSS follows window resizes on its own.
 */
const FIT_HEIGHT = "min(100vh - 234px, (100vw - 406px) / var(--ratio))";
const STAGE_WIDTH = "max(776px, var(--fit-h) * var(--ratio))";

/** The height of the dialog's body: the stage and the strip below it. */
const BODY_HEIGHT = "calc(var(--fit-h) + 116px)";

/** Whether a key pressed on `target` belongs to it, as an arrow key on the seek bar does. */
const ownsArrows = (target: EventTarget) =>
    target instanceof Element && target.closest('[role="slider"], input, textarea, select') !== null;

const ICON_BUTTON =
    "flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#27272A] bg-transparent p-0 text-[#E4E4E7] outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-40";

type DetailsDialogProps = {
    /** The files Previous, Next and the strip step through, in order. */
    files: readonly MediaFile[];
    /** The one to show, which is one of `files`. */
    file: MediaFile;
    /** Where the file is among `files`, after its name in the title bar: "4 of 48" or "Group 1 · 1 of 3". */
    position: string;
    /** Shows another of `files`. */
    onShow: (file: MediaFile) => void;
    onClose: () => void;
    /** The sidebar's chips. */
    chips: ReactNode;
    /** The sidebar's button below "Open in app" and "Show in folder". */
    action: ReactNode;
    /** The paths of the files marked for deletion, which the strip shows as such. */
    marks?: ReadonlySet<string>;
    /** Puts focus back where the caller wants it, once the dialog has closed. */
    onClosed?: () => void;
};

/**
 * The media details of one file over the dimmed screen: its picture or player, a strip of its neighbours among
 * `files`, and its details. Shaped to the file; what it steps through and what its sidebar adds are the caller's.
 */
export const DetailsDialog = ({
    files,
    file,
    position,
    onShow,
    onClose,
    chips,
    action,
    marks,
    onClosed,
}: DetailsDialogProps) => {
    const details = useFileDetails(file);
    const [ratio, setRatio] = useState(FIRST_RATIO);
    // The shape the picture reported once it loaded, which stands in when the details can't give one. Kept per file,
    // since the picture may load before the details fail.
    const [pictured, setPictured] = useState<{ path: string; ratio: number }>();
    const openedAt = useRef(0);

    useEffect(() => {
        openedAt.current = performance.now();
    }, []);

    // Keep the last known shape until this file's is read, so stepping doesn't flash a default one.
    const known =
        details.status === "ready"
            ? details.info.width / details.info.height
            : details.status === "failed" && pictured?.path === file.path
              ? pictured.ratio
              : undefined;
    if (known !== undefined && Number.isFinite(known) && known > 0 && known !== ratio) setRatio(known);

    const index = indexOfPath(files, file.path);
    const previous = previousOf(files, index);
    const next = nextOf(files, index);
    const show = (target?: MediaFile) => target && onShow(target);

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (ownsArrows(event.target)) return;

        event.preventDefault();
        show(event.key === "ArrowLeft" ? previous : next);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                aria-describedby={undefined}
                onKeyDown={onKeyDown}
                // The caller puts focus back itself: the file it last showed may not be the one it opened on, and the
                // gallery's tile may have been virtualized away.
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    onClosed?.();
                }}
                // A click on the backdrop closes it, unless it is the second click of a double click on a tile, which
                // opened it with the first.
                onPointerDownOutside={(event) => {
                    if (performance.now() - openedAt.current < DOUBLE_CLICK_MS) event.preventDefault();
                }}
                style={{ "--ratio": ratio, "--fit-h": FIT_HEIGHT } as CSSProperties}
                className="flex flex-col overflow-hidden rounded-[14px] border border-[#27272A] bg-[#0C0C0E] text-[#FAFAFA] shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
            >
                <DialogTitle className="sr-only">Media details: {file.name}</DialogTitle>

                <div className="box-border flex h-[52px] shrink-0 items-center gap-2.5 border-[#1F1F23] border-b pr-2.5 pl-[18px]">
                    <span aria-hidden="true" className="truncate font-medium font-mono text-sm">
                        {file.name}
                    </span>
                    <span className="grow whitespace-nowrap text-[#A1A1AA] text-xs">{position}</span>
                    <button
                        type="button"
                        aria-label="Previous file"
                        disabled={!previous}
                        onClick={() => show(previous)}
                        className={ICON_BUTTON}
                    >
                        <ChevronLeftIcon aria-hidden="true" className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label="Next file"
                        disabled={!next}
                        onClick={() => show(next)}
                        className={ICON_BUTTON}
                    >
                        <ChevronRightIcon aria-hidden="true" className="size-4" />
                    </button>
                    <span aria-hidden="true" className="mx-1 h-5 w-px bg-[#27272A]" />
                    <DialogClose aria-label="Close" className={cn(ICON_BUTTON, "border-transparent text-[#A1A1AA]")}>
                        <XIcon aria-hidden="true" className="size-4" />
                    </DialogClose>
                </div>

                <div className="flex min-h-0" style={{ height: BODY_HEIGHT }}>
                    <div className="flex shrink-0 flex-col" style={{ width: STAGE_WIDTH }}>
                        <DetailsStage
                            file={file}
                            onRatio={(shape) => shape !== undefined && setPictured({ path: file.path, ratio: shape })}
                        />
                        <Filmstrip files={files} index={index} onShow={show} {...(marks && { marks })} />
                    </div>
                    {/* Keyed by path, so an action's failure message is gone once another file is shown. */}
                    <DetailsSidebar key={file.path} file={file} details={details} chips={chips} action={action} />
                </div>
            </DialogContent>
        </Dialog>
    );
};
