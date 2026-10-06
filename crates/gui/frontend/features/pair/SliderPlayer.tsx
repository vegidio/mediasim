import { useRef } from "react";
import type { Slot } from "@/features/start/routePairDrop";
import type { MediaFile } from "@/ipc/thumbs";
import { videoUrl } from "@/ipc/video";
import { cn } from "@/lib/utils";
import { PlayerBar } from "./PlayerBar";
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
    const playback = useSyncedPlayback(videoA, videoB);
    useVideoSource(videoA, videoUrl(a.identity));
    useVideoSource(videoB, videoUrl(b.identity));

    // Hidden until they first play, so the stills show; and both again if either fails, since a moving picture wiped
    // against a still one would mislead.
    const className = cn(
        "absolute inset-0 size-full object-contain",
        (!playback.started || playback.failed) && "invisible",
    );

    return (
        <SliderStage
            a={a}
            b={b}
            {...stage}
            media={{
                a: <video ref={videoA} muted playsInline preload="metadata" className={className} />,
                b: <video ref={videoB} muted playsInline preload="metadata" className={className} />,
            }}
            bar={<PlayerBar name="A and B" muteName="A" playback={playback} />}
        />
    );
};
