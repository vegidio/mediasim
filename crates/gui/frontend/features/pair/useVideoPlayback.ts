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

/** A player's state before its element has reported anything: paused at 0, muted. */
export const INITIAL: VideoPlaybackState = { playing: false, time: 0, muted: true, started: false, failed: false };

const STATE_KEYS = [
    "playing",
    "time",
    "duration",
    "muted",
    "started",
    "failed",
] as const satisfies readonly (keyof VideoPlaybackState)[];

/** `next`, or `previous` itself when they are equal, so a state update that changes nothing skips the render. */
export const unlessUnchanged = (previous: VideoPlaybackState, next: VideoPlaybackState) =>
    STATE_KEYS.every((key) => previous[key] === next[key]) ? previous : next;

/** An element's duration, once it knows it. */
export const knownDuration = (video: HTMLVideoElement) =>
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;

/** Plays `video`; one that can't also dispatches `error`, which is what the player shows. */
export const play = (video: HTMLVideoElement) => {
    video.play().catch(() => {});
};

/** Mutes `video` if it plays its sound, or unmutes it. */
export const toggleMuted = (video: HTMLVideoElement | null) => {
    if (video) video.muted = !video.muted;
};

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
                const duration = knownDuration(video);
                const { duration: _, ...rest } = previous;
                return unlessUnchanged(previous, {
                    ...rest,
                    playing: !video.paused,
                    time: video.currentTime,
                    muted: video.muted,
                    ...(duration !== undefined && { duration }),
                });
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
        play(video);
    };

    const seek = (time: number) => {
        if (ref.current) ref.current.currentTime = time;
    };

    const toggleMute = () => toggleMuted(ref.current);

    return { ...state, toggle, seek, toggleMute };
};
