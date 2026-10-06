import { useRef } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useVideoPlayback, type VideoPlayback } from "./useVideoPlayback";

// `duration` and `ended` are read-only to the type, as the element sets them; the test setup's stub lets a test stand
// for that through `Object.assign`.

/** Renders a muted `<video>` driven by the hook, and returns the element and the hook's latest result. */
const setup = () => {
    const latest: { current?: VideoPlayback } = {};
    const Harness = () => {
        const ref = useRef<HTMLVideoElement>(null);
        latest.current = useVideoPlayback(ref);
        return <video ref={ref} muted data-testid="video" />;
    };
    const { getByTestId } = render(<Harness />);

    return {
        video: getByTestId("video") as HTMLVideoElement,
        playback: () => latest.current as VideoPlayback,
    };
};

describe("useVideoPlayback", () => {
    it("starts muted, paused, at 0, not started and not failed, with no duration", () => {
        const { playback } = setup();

        expect(playback()).toMatchObject({ playing: false, time: 0, muted: true, started: false, failed: false });
        expect(playback().duration).toBeUndefined();
    });

    it("learns the duration from the element", () => {
        const { video, playback } = setup();

        act(() => {
            Object.assign(video, { duration: 42 });
        });

        expect(playback().duration).toBe(42);
    });

    it("plays, then pauses, on toggle", () => {
        const { video, playback } = setup();

        act(() => playback().toggle());

        expect(video.paused).toBe(false);
        expect(playback()).toMatchObject({ playing: true, started: true });

        act(() => playback().toggle());

        expect(video.paused).toBe(true);
        expect(playback()).toMatchObject({ playing: false, started: true });
    });

    it("moves the element to the time asked by seek", () => {
        const { video, playback } = setup();
        act(() => {
            Object.assign(video, { duration: 42 });
        });

        act(() => playback().seek(21));

        expect(video.currentTime).toBe(21);
        expect(playback().time).toBe(21);
    });

    it("unmutes, then mutes, on toggleMute", () => {
        const { video, playback } = setup();

        act(() => playback().toggleMute());

        expect(video.muted).toBe(false);
        expect(playback().muted).toBe(false);

        act(() => playback().toggleMute());

        expect(video.muted).toBe(true);
        expect(playback().muted).toBe(true);
    });

    it("stops at the end, and plays from 0 on the next toggle", () => {
        const { video, playback } = setup();
        act(() => {
            Object.assign(video, { duration: 42 });
            playback().toggle();
            video.currentTime = 42;
            Object.assign(video, { ended: true });
        });

        expect(playback()).toMatchObject({ playing: false, time: 42 });

        act(() => playback().toggle());

        expect(video.currentTime).toBe(0);
        expect(playback()).toMatchObject({ playing: true, time: 0 });
    });

    it("fails when the element had already failed before the hook listened", () => {
        const Harness = () => {
            const ref = useRef<HTMLVideoElement>(null);
            const { failed } = useVideoPlayback(ref);
            return (
                <video
                    muted
                    data-failed={failed}
                    ref={(element) => {
                        // Before the hook's effect, as a load refused at once would be.
                        if (element) Object.assign(element, { error: { code: 4 } });
                        ref.current = element;
                    }}
                />
            );
        };

        const { container } = render(<Harness />);

        expect(container.querySelector("video")).toHaveAttribute("data-failed", "true");
    });

    it("fails on the element's error", () => {
        const { video, playback } = setup();

        act(() => {
            video.dispatchEvent(new Event("error"));
        });

        expect(playback()).toMatchObject({ failed: true, playing: false });
    });
});
