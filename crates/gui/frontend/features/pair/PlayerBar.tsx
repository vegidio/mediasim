import type { KeyboardEvent } from "react";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Slider } from "radix-ui";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VideoPlayback } from "./useVideoPlayback";

/** How far the arrow keys move playback, in seconds. */
const ARROW_STEP = 5;

/**
 * Where each key moves playback from `time` in a video of `duration` seconds. Radix's own keys step by `step`, which
 * is fine-grained so a drag doesn't snap, so these replace them.
 */
const KEY_MOVES: Record<string, (time: number, duration: number) => number> = {
    ArrowLeft: (time) => time - ARROW_STEP,
    ArrowDown: (time) => time - ARROW_STEP,
    ArrowRight: (time) => time + ARROW_STEP,
    ArrowUp: (time) => time + ARROW_STEP,
    PageDown: (time, duration) => time - duration / 10,
    PageUp: (time, duration) => time + duration / 10,
    Home: () => 0,
    End: (_, duration) => duration,
};

const BUTTON =
    "flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary";

type PlayerBarProps = {
    /** The file's name, which every control's name includes. */
    name: string;
    /** The name the mute button's own name includes, when its sound is only some of `name`'s; `name` by default. */
    muteName?: string;
    playback: VideoPlayback;
};

/**
 * One video's controls, as artboard 2d draws them: play or pause, the time, a seek bar and mute. When the video can't
 * be played, a note in their place. No `aria-pressed` on the buttons: their names already change with the state.
 */
export const PlayerBar = ({ name, muteName = name, playback }: PlayerBarProps) => {
    const { playing, time, duration, muted, failed, toggle, seek, toggleMute } = playback;

    if (failed) {
        return (
            <div className="flex h-11 items-center justify-center rounded-[10px] bg-[rgba(9,9,11,.82)] px-3 text-[#A1A1AA] text-[13px]">
                Can't play this format yet
            </div>
        );
    }

    const shown = Math.min(time, duration ?? time);
    const total = duration === undefined ? "-:--" : formatDuration(duration);

    const onKeyDown = (event: KeyboardEvent) => {
        const move = KEY_MOVES[event.key];
        if (!move || duration === undefined) return;

        // Stops Radix's own handler, which runs after this one unless the default is prevented.
        event.preventDefault();
        seek(Math.min(duration, Math.max(0, move(shown, duration))));
    };

    return (
        // A fieldset is a group named by its label; `min-w-0` undoes its `min-content` width, so a narrow bar shrinks.
        <fieldset
            aria-label={`Player for ${name}`}
            className="m-0 flex h-11 min-w-0 items-center gap-3 rounded-[10px] border-0 bg-[rgba(9,9,11,.82)] px-3 py-0"
        >
            <button
                type="button"
                aria-label={`${playing ? "Pause" : "Play"} ${name}`}
                onClick={toggle}
                className={cn(BUTTON, "bg-[#FAFAFA] text-[#09090B]")}
            >
                {playing ? (
                    <PauseIcon aria-hidden="true" className="size-3 fill-current" />
                ) : (
                    <PlayIcon aria-hidden="true" className="size-3 fill-current" />
                )}
            </button>

            <span className="shrink-0 font-mono text-[#E4E4E7] text-xs tabular-nums">
                {formatDuration(shown)} / {total}
            </span>

            <Slider.Root
                min={0}
                max={duration ?? 1}
                step={0.01}
                value={[duration === undefined ? 0 : shown]}
                disabled={duration === undefined}
                onValueChange={([value]) => value !== undefined && seek(value)}
                onKeyDown={onKeyDown}
                className="relative flex h-full min-w-0 flex-1 cursor-pointer touch-none select-none items-center data-[disabled]:cursor-default"
            >
                <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-[#3F3F46]">
                    <Slider.Range className="absolute h-full bg-[#BEF264]" />
                </Slider.Track>
                <Slider.Thumb
                    aria-label={`Seek ${name}`}
                    aria-valuetext={`${formatDuration(shown)} of ${total}`}
                    className="block size-2.5 rounded-full bg-[#FAFAFA] outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
            </Slider.Root>

            <button
                type="button"
                aria-label={`${muted ? "Unmute" : "Mute"} ${muteName}`}
                onClick={toggleMute}
                className={cn(BUTTON, "bg-transparent text-[#E4E4E7]")}
            >
                {muted ? (
                    <VolumeXIcon aria-hidden="true" className="size-[15px]" />
                ) : (
                    <Volume2Icon aria-hidden="true" className="size-[15px]" />
                )}
            </button>
        </fieldset>
    );
};
