import { type ReactNode, useRef } from "react";
import type { MediaFile } from "@/ipc/thumbs";
import { videoUrl } from "@/ipc/video";
import { cn } from "@/lib/utils";
import { Picture } from "./Picture";
import { PlayerBar } from "./PlayerBar";
import { useVideoPlayback } from "./useVideoPlayback";
import { useVideoSource } from "./useVideoSource";

type VideoPlayerProps = {
    file: MediaFile;
    className?: string;
    /** Drawn over the playing video as over the still, under the player bar. */
    overlay?: ReactNode;
};

/**
 * A video's {@link Picture} that plays: its still until it first plays, then the video in the same place, with its
 * {@link PlayerBar} along the bottom. Starts paused and muted, and stops for good when it unmounts.
 */
export const VideoPlayer = ({ file, ...picture }: VideoPlayerProps) => {
    const video = useRef<HTMLVideoElement>(null);
    const playback = useVideoPlayback(video);
    const url = videoUrl(file.identity);

    useVideoSource(video, url);

    return (
        <Picture
            file={file}
            {...picture}
            media={
                <video
                    ref={video}
                    muted
                    playsInline
                    preload="metadata"
                    // Hidden until it first plays, so the still shows; and again if it fails, so the still stays.
                    className={cn(
                        "absolute inset-0 size-full object-contain",
                        (!playback.started || playback.failed) && "invisible",
                    )}
                />
            }
            bar={<PlayerBar name={file.name} playback={playback} />}
        />
    );
};
