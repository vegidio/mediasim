import { type ReactNode, useRef } from "react";
import type { MediaFile } from "@/ipc/thumbs";
import { Picture } from "./Picture";
import { PlayerBar } from "./PlayerBar";
import { PlayerVideo } from "./PlayerVideo";
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
    // Before the playback hook, so its listener sees the element's errors first; see `useVideoSource`.
    const { ready, noSound } = useVideoSource(video, file);
    const playback = useVideoPlayback(video);

    return (
        <Picture
            file={file}
            {...picture}
            media={
                // Hidden until it first plays, so the still shows; and again if it fails, so the still stays.
                <PlayerVideo ref={video} visible={playback.started && !playback.failed} />
            }
            bar={<PlayerBar name={file.name} playback={playback} ready={ready} noSound={noSound} />}
        />
    );
};
