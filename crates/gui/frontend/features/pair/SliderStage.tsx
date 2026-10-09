import { type KeyboardEvent, type ReactNode, useState } from "react";
import { ChevronsLeftRightIcon, Trash2Icon } from "lucide-react";
import { Slider } from "radix-ui";
import type { MediaFile } from "@/ipc/thumbs";
import type { Slot } from "@/lib/slots";
import { cn } from "@/lib/utils";
import { type GoneKind, NONE_GONE } from "@/stores/pairResult";
import { MarkWash } from "./MarkWash";
import { BAR_BOX, barStyle, Picture } from "./Picture";
import { VideoPlayer } from "./VideoPlayer";

/**
 * Where each key moves the handle from `position`. Radix's own keys step by `step`, which is fine-grained so a drag
 * doesn't snap, so these replace them.
 */
const KEY_MOVES: Record<string, (position: number) => number> = {
    ArrowLeft: (position) => position - 1,
    ArrowDown: (position) => position - 1,
    ArrowRight: (position) => position + 1,
    ArrowUp: (position) => position + 1,
    PageDown: (position) => position - 10,
    PageUp: (position) => position + 10,
    Home: () => 0,
    End: () => 100,
};

const clamp = (position: number) => Math.min(100, Math.max(0, position));

type SliderStageProps = {
    a: MediaFile;
    b: MediaFile;
    /** The share of the stage showing A, from 0 to 100. */
    position: number;
    onPositionChange: (position: number) => void;
    /** Which files are marked for deletion, each tagged in its corner. */
    marked: Record<Slot, boolean>;
    /** How each file that has left went, neither by default; one gone leaves the other alone, with no handle. */
    gone?: Partial<Record<Slot, GoneKind>>;
    /** Drawn in each side's picture, over its still and under its wash, such as its playing video. */
    media?: Record<Slot, ReactNode>;
    /**
     * Drawn above everything, along the bottom of the smallest rectangle around both pictures, 12 px inside it, but
     * never narrower than 280 px or the stage, whichever is less. Along the stage's bottom edge until a picture's shape
     * is known. Presses on it never reach the handle.
     */
    bar?: ReactNode;
};

/** A marked file's tag, in its own corner of the stage. Hidden from assistive technology: the header's buttons state the mark. */
const DeleteTag = ({ slot }: { slot: Slot }) => (
    <span
        aria-hidden="true"
        data-testid={`delete-tag-${slot}`}
        className={cn(
            "pointer-events-none absolute top-2.5 rounded-md bg-danger px-[9px] py-[3px] font-semibold text-white text-xs",
            slot === "a" ? "left-2.5" : "right-2.5",
        )}
    >
        {slot.toUpperCase()} · Delete
    </span>
);

/**
 * A over B in one frame that fills the view, A showing left of the handle and B right of it. Each is fitted inside it
 * whole and centred. Pressing or dragging anywhere on the stage, edge to edge, moves the handle.
 */
export const SliderStage = ({
    a,
    b,
    position,
    onPositionChange,
    marked,
    gone = NONE_GONE,
    media,
    bar,
}: SliderStageProps) => {
    /** Each picture's width over its height, by file identity, so another file's shape never stands in for it. */
    const [ratios, setRatios] = useState<Partial<Record<string, number>>>({});
    const onRatio = (identity: string) => (ratio?: number) =>
        setRatios(({ [identity]: _replaced, ...rest }) => (ratio ? { ...rest, [identity]: ratio } : rest));

    const onKeyDown = (event: KeyboardEvent) => {
        const move = KEY_MOVES[event.key];
        if (!move) return;

        // Stops Radix's own handler, which runs after this one unless the default is prevented.
        event.preventDefault();
        onPositionChange(clamp(move(position)));
    };

    if (gone.a && gone.b) {
        return (
            <div
                data-testid="slider-stage"
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 bg-background bg-dots text-muted-foreground text-[13px]"
            >
                <Trash2Icon aria-hidden="true" className="size-[22px]" />
                {gone.a === "trash" && gone.b === "trash"
                    ? "Both files moved to Trash"
                    : gone.a === "permanent" && gone.b === "permanent"
                      ? "Both files deleted"
                      : "Both files removed"}
            </div>
        );
    }

    // The file still in place, on its own: there is nothing to compare it with, so no handle. `position` is kept.
    const remaining: Slot | undefined = gone.a ? "b" : gone.b ? "a" : undefined;
    if (remaining) {
        const file = remaining === "a" ? a : b;
        // A video plays on its own, as in the side-by-side view; mounted afresh, so it starts paused at 0 and muted.
        const Lone = file.type === "video" ? VideoPlayer : Picture;
        return (
            <div data-testid="slider-stage" className="relative min-h-0 flex-1 overflow-hidden bg-background bg-dots">
                <Lone
                    key={file.identity}
                    file={file}
                    className="absolute inset-0"
                    overlay={marked[remaining] && <MarkWash />}
                />
                {marked[remaining] && <DeleteTag slot={remaining} />}
            </div>
        );
    }

    return (
        // Opaque, with its own dots, so A's layer can repeat them exactly: both are this same box. A size container, so
        // the shared bar can fit itself to both pictures with `cq` units rather than measuring.
        <div
            data-testid="slider-stage"
            className="relative min-h-0 flex-1 overflow-hidden bg-background bg-dots [container-type:size]"
        >
            {/* Keyed so another file starts loading afresh rather than showing as loaded. */}
            {/*
             * Each wash covers its own picture alone, in its file's own layer, so it tints only that picture's part on
             * that file's side of the handle.
             */}
            <Picture
                key={b.identity}
                file={b}
                className="absolute inset-0"
                overlay={marked.b && <MarkWash />}
                media={media?.b}
                onRatio={onRatio(b.identity)}
            />
            <div
                data-testid="slider-a"
                style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
                // Opaque, so B never shows left of the handle where A's picture doesn't cover, or hasn't loaded.
                className="absolute inset-0 bg-background bg-dots"
            >
                <Picture
                    key={a.identity}
                    file={a}
                    className="absolute inset-0"
                    overlay={marked.a && <MarkWash />}
                    media={media?.a}
                    onRatio={onRatio(a.identity)}
                />
            </div>

            <div
                aria-hidden="true"
                style={{ left: `${position}%` }}
                className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
            />

            {/* The whole stage is the track; the line and the clip above draw the value, so no Track or Range. */}
            <Slider.Root
                min={0}
                max={100}
                step={0.1}
                value={[position]}
                onValueChange={([value]) => value !== undefined && onPositionChange(value)}
                onKeyDown={onKeyDown}
                className="absolute inset-0 flex cursor-ew-resize touch-none select-none items-center"
            >
                {/*
                 * Zero-sized, so Radix has no half-width to pull inward near the ends and the thumb sits exactly on the
                 * line; the grip is drawn centred on it, so it never drifts off the line.
                 */}
                <Slider.Thumb
                    aria-label="Drag to compare A and B"
                    aria-valuetext={`${Math.round(position)}% A`}
                    className="group relative block size-0 outline-none"
                >
                    <span className="absolute top-1/2 left-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-foreground text-background shadow-[0_4px_16px_rgba(0,0,0,0.5)] group-focus-visible:ring-4 group-focus-visible:ring-primary">
                        <ChevronsLeftRightIcon aria-hidden="true" className="size-5" />
                    </span>
                </Slider.Thumb>
            </Slider.Root>

            {/* Above every layer and outside A's clip, so each stays whole and put; click-through to the Root. */}
            {marked.a && <DeleteTag slot="a" />}
            {marked.b && <DeleteTag slot="b" />}

            {/*
             * Last, so it is above the Root: a sibling rather than a descendant, so presses on it never reach Radix's
             * pointer handlers and never move the handle.
             */}
            {bar && (
                <div
                    data-testid="slider-bar"
                    style={sharedBarStyle(ratios[a.identity], ratios[b.identity])}
                    className={BAR_BOX}
                >
                    {bar}
                </div>
            )}
        </div>
    );
};

/**
 * Where the shared bar sits over both pictures: both are fitted and centred in the stage, so the smallest rectangle
 * around them is as wide as the wider one and as tall as the taller one. With one shape known, that one alone.
 */
const sharedBarStyle = (ratioA?: number, ratioB?: number) => {
    const known = [ratioA, ratioB].filter((ratio) => ratio !== undefined);
    return known.length > 0 ? barStyle(Math.max(...known), Math.min(...known)) : undefined;
};
