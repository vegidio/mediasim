import { type ReactNode, useEffect, useRef } from "react";
import type { MediaFile } from "@/ipc/thumbs";
import { videoUrl } from "@/ipc/video";
import { cn } from "@/lib/utils";
import { Picture } from "./Picture";
import { PlayerBar } from "./PlayerBar";
import { useVideoPlayback } from "./useVideoPlayback";

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

    // The source is set here rather than as a prop, so it is set again on every mount: StrictMode's rehearsal unmount
    // clears it, and React wouldn't restore a prop that hasn't changed. Declared after the hook, so its listeners are
    // in place before loading starts.
    //
    // Unmounting alone leaves the element to be collected, still playing until then. The cleanup silences it at once
    // and releases its decoder and its requests.
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        element.src = url;

        return () => {
            element.pause();
            element.removeAttribute("src");
            element.load();
        };
    }, [url]);

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
