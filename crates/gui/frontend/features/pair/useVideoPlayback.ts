import { type RefObject, useEffect, useState } from "react";

/** What a player shows of one `<video>`, mirrored from the element's own events. */
export type VideoPlaybackState = {
    playing: boolean;
    /** The position, in seconds. */
    time: number;
    /** In seconds, once the element knows it. */
    duration?: number;
    muted: boolean;
    /** Whether the video has played at least once, until which its still shows in its place. */
    started: boolean;
    /** Whether the element couldn't load or decode the video. */
    failed: boolean;
};

/** A player's view of one `<video>`, and what it can do to it. */
export type VideoPlayback = VideoPlaybackState & {
    /** Plays, from the beginning if the video has ended, or pauses. */
    toggle: () => void;
    /** Moves to `time` seconds. */
    seek: (time: number) => void;
    toggleMute: () => void;
};

const INITIAL: VideoPlaybackState = { playing: false, time: 0, muted: true, started: false, failed: false };

/** The events whose state {@link useVideoPlayback} reads afresh. */
const SYNCED = ["play", "pause", "timeupdate", "durationchange", "volumechange", "ended", "emptied"] as const;

/**
 * Mirrors the state of the `<video>` in `ref` from its events, and drives it. The element is the source of truth:
 * every action goes to it, and the state follows from the events it dispatches.
 */
export const useVideoPlayback = (ref: RefObject<HTMLVideoElement | null>): VideoPlayback => {
    const [state, setState] = useState(INITIAL);

    useEffect(() => {
        const video = ref.current;
        if (!video) return;

        const sync = () =>
            setState((previous) => {
                const { duration } = video;
                const { duration: _, ...rest } = previous;
                return {
                    ...rest,
                    playing: !video.paused,
                    time: video.currentTime,
                    muted: video.muted,
                    ...(Number.isFinite(duration) && duration > 0 && { duration }),
                };
            });
        const start = () => setState((previous) => ({ ...previous, started: true }));
        const fail = () => setState((previous) => ({ ...previous, failed: true, playing: false }));

        for (const event of SYNCED) video.addEventListener(event, sync);
        video.addEventListener("play", start);
        video.addEventListener("error", fail);
        sync();
        // The element starts loading as soon as it is created, so it may have failed before these listeners existed.
        if (video.error) fail();

        return () => {
            for (const event of SYNCED) video.removeEventListener(event, sync);
            video.removeEventListener("play", start);
            video.removeEventListener("error", fail);
        };
    }, [ref]);

    const toggle = () => {
        const video = ref.current;
        if (!video) return;

        if (!video.paused) {
            video.pause();
            return;
        }
        if (video.ended) video.currentTime = 0;
        // A video that can't play also dispatches `error`, which is what the player shows.
        video.play().catch(() => {});
    };

    const seek = (time: number) => {
        if (ref.current) ref.current.currentTime = time;
    };

    const toggleMute = () => {
        if (ref.current) ref.current.muted = !ref.current.muted;
    };

    return { ...state, toggle, seek, toggleMute };
};
