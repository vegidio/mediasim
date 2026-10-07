import { useRef } from "react";
import type { Slot } from "@/features/start/routePairDrop";
import type { MediaFile } from "@/ipc/thumbs";
import { PlayerBar } from "./PlayerBar";
import { PlayerVideo } from "./PlayerVideo";
import { SliderStage } from "./SliderStage";
import { useSyncedPlayback } from "./useSyncedPlayback";
import { useVideoSource } from "./useVideoSource";

type SliderPlayerProps = {
    a: MediaFile;
    b: MediaFile;
    /** The share of the stage showing A, from 0 to 100. */
    position: number;
    onPositionChange: (position: number) => void;
    /** Which files are marked for deletion. */
    marked: Record<Slot, boolean>;
};

/**
 * The slider stage for two videos, played in step under one {@link PlayerBar}: each side's still until they first
 * play, then the videos in the same places. Both start paused and muted, and stop for good when it unmounts.
 */
export const SliderPlayer = ({ a, b, ...stage }: SliderPlayerProps) => {
    const videoA = useRef<HTMLVideoElement>(null);
    const videoB = useRef<HTMLVideoElement>(null);
    // Before the playback hook, so their listeners see the elements' errors first; see `useVideoSource`.
    const sourceA = useVideoSource(videoA, a);
    const sourceB = useVideoSource(videoB, b);
    const playback = useSyncedPlayback(videoA, videoB);

    // Hidden until they first play, so the stills show; and both again if either fails, since a moving picture wiped
    // against a still one would mislead.
    const visible = playback.started && !playback.failed;

    return (
        <SliderStage
            a={a}
            b={b}
            {...stage}
            media={{
                a: <PlayerVideo ref={videoA} visible={visible} />,
                b: <PlayerVideo ref={videoB} visible={visible} />,
            }}
            bar={
                <PlayerBar
                    name="A and B"
                    muteName="A"
                    playback={playback}
                    ready={sourceA.ready && sourceB.ready}
                    // Only A's sound ever plays, so only A's missing sound takes the mute button away.
                    noSound={sourceA.noSound}
                />
            }
        />
    );
};
