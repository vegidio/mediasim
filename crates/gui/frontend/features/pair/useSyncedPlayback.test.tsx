import { useRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_COOLDOWN } from "./syncStep";
import { useSyncedPlayback } from "./useSyncedPlayback";
import type { VideoPlayback } from "./useVideoPlayback";

// `duration` and `ended` are read-only to the type, as the element sets them; the test setup's stub lets a test stand
// for that through `Object.assign`. The stub dispatches no `seeked`, `waiting` or `playing` of its own, so the tests
// dispatch those where a browser would.

/** Renders two muted `<video>` elements driven by the hook, and returns them and the hook's latest result. */
const setup = (durations?: { a: number; b: number }) => {
    const latest: { current?: VideoPlayback } = {};
    const Harness = () => {
        const refA = useRef<HTMLVideoElement>(null);
        const refB = useRef<HTMLVideoElement>(null);
        latest.current = useSyncedPlayback(refA, refB);
        return (
            <>
                <video ref={refA} muted data-testid="a" />
                <video ref={refB} muted data-testid="b" />
            </>
        );
    };
    const { getByTestId } = render(<Harness />);
    const a = getByTestId("a") as HTMLVideoElement;
    const b = getByTestId("b") as HTMLVideoElement;
    if (durations) {
        act(() => {
            Object.assign(a, { duration: durations.a });
            Object.assign(b, { duration: durations.b });
        });
    }

    return { a, b, playback: () => latest.current as VideoPlayback };
};

/**
 * Stands for both elements playing on to `time`, each held at its own end, with the leader's `timeupdate` last. An
 * ended follower is left alone, as it would stay.
 */
const playTo = (time: number, ...[leader, follower]: [HTMLVideoElement, HTMLVideoElement]) => {
    act(() => {
        if (!follower.ended) follower.currentTime = Math.min(time, follower.duration);
        leader.currentTime = Math.min(time, leader.duration);
    });
};

/** Lets the cooldown after a correction or a seek pass. */
const cooldown = () => vi.advanceTimersByTime(SYNC_COOLDOWN);

describe("useSyncedPlayback", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["performance"] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("starts paused, at 0, muted, not started and not failed, with no duration", () => {
        const { playback } = setup();

        expect(playback()).toMatchObject({ playing: false, time: 0, muted: true, started: false, failed: false });
        expect(playback().duration).toBeUndefined();
    });

    it("plays and pauses both on toggle, and starts on the first play", () => {
        const { a, b, playback } = setup({ a: 42, b: 42 });

        act(() => playback().toggle());

        expect([a.paused, b.paused]).toEqual([false, false]);
        expect(playback()).toMatchObject({ playing: true, started: true });

        act(() => playback().toggle());

        expect([a.paused, b.paused]).toEqual([true, true]);
        expect(playback()).toMatchObject({ playing: false, started: true });
    });

    it("follows the longer video's time and duration once both durations are known", () => {
        const { a, b, playback } = setup();

        act(() => {
            Object.assign(a, { duration: 30 });
        });

        expect(playback().duration).toBeUndefined();

        act(() => {
            Object.assign(b, { duration: 42 });
            a.currentTime = 12;
            b.currentTime = 12.5;
        });

        expect(playback()).toMatchObject({ duration: 42, time: 12.5 });
    });

    it("moves each element to the time sought, held at its own end", () => {
        const { a, b, playback } = setup({ a: 42, b: 30 });

        act(() => playback().seek(36));

        expect(a.currentTime).toBe(36);
        expect(b.currentTime).toBe(30);
        expect(playback().time).toBe(36);
    });

    it("brings a follower that falls 0.3 s behind back in step", () => {
        const { a, b, playback } = setup({ a: 42, b: 42 });
        act(() => playback().toggle());
        cooldown();

        act(() => {
            b.currentTime = 9.7;
            a.currentTime = 10;
        });

        expect(Math.abs(a.currentTime - b.currentTime)).toBeLessThanOrEqual(0.1);
        expect([a.paused, b.paused]).toEqual([false, false]);
    });

    it("leaves the follower alone within the cooldown after a correction", () => {
        const { a, b, playback } = setup({ a: 42, b: 42 });
        act(() => playback().toggle());
        cooldown();
        playTo(10, a, b);
        act(() => {
            b.currentTime = 9.7;
            a.currentTime = 10;
        });

        act(() => {
            b.currentTime = 10.2;
            a.currentTime = 10.6;
        });

        expect(b.currentTime).toBe(10.2);
    });

    it("learns to seek ahead by what a correction left behind", () => {
        const { a, b, playback } = setup({ a: 42, b: 42 });
        act(() => playback().toggle());
        cooldown();
        act(() => {
            b.currentTime = 9.7;
            a.currentTime = 10;
        });
        expect(b.currentTime).toBe(10);

        // The seek stalled B: a second on, it trails by 0.45 s, and the next correction makes up for it.
        cooldown();
        act(() => {
            b.currentTime = 10.55;
            a.currentTime = 11;
        });

        expect(b.currentTime).toBeCloseTo(11.45);
    });

    it("pauses B while A waits for data, and plays both on together once A can, still playing", () => {
        const { a, b, playback } = setup({ a: 42, b: 42 });
        act(() => playback().toggle());

        fireEvent(a, new Event("waiting"));

        expect(b.paused).toBe(true);
        expect(a.paused).toBe(false);
        expect(playback().playing).toBe(true);

        fireEvent(a, new Event("playing"));

        expect([a.paused, b.paused]).toEqual([false, false]);
        expect(playback().playing).toBe(true);
    });

    it("pauses A while B waits for data, and plays both on together once B can", () => {
        const { a, b, playback } = setup({ a: 42, b: 42 });
        act(() => playback().toggle());

        fireEvent(b, new Event("waiting"));
        // A stalled follower's own drift is not corrected, nor is it played, while it waits.
        playTo(10, a, b);

        expect(a.paused).toBe(true);

        fireEvent(b, new Event("canplay"));

        expect([a.paused, b.paused]).toEqual([false, false]);
    });

    it("leaves the shorter video ended on its last frame while the longer one plays on", () => {
        const { a, b, playback } = setup({ a: 42, b: 30 });
        act(() => playback().toggle());
        playTo(30, a, b);

        act(() => {
            Object.assign(b, { ended: true });
        });
        playTo(35, a, b);

        expect(b).toMatchObject({ currentTime: 30, ended: true, paused: true });
        expect(a.paused).toBe(false);
        expect(playback()).toMatchObject({ time: 35, duration: 42, playing: true });
    });

    it("plays the shorter video again in step when seeking back before its end", () => {
        const { a, b, playback } = setup({ a: 42, b: 30 });
        act(() => playback().toggle());
        playTo(30, a, b);
        act(() => {
            Object.assign(b, { ended: true });
        });
        playTo(35, a, b);

        act(() => playback().seek(10));

        expect(b).toMatchObject({ currentTime: 10, ended: false, paused: false });
        expect(a).toMatchObject({ currentTime: 10, paused: false });
    });

    it("leads with B when B is the longer", () => {
        const { a, b, playback } = setup({ a: 30, b: 42 });
        act(() => playback().toggle());
        cooldown();

        act(() => {
            a.currentTime = 9.7;
            b.currentTime = 10;
        });

        expect(a.currentTime).toBe(10);
        expect(playback()).toMatchObject({ time: 10, duration: 42 });
    });

    it("clears the intent at the leader's end, and plays both from 0 on the next toggle", () => {
        const { a, b, playback } = setup({ a: 42, b: 30 });
        act(() => playback().toggle());
        playTo(42, a, b);
        act(() => {
            Object.assign(b, { ended: true });
            Object.assign(a, { ended: true });
        });

        expect(playback().playing).toBe(false);
        expect([a.currentTime, b.currentTime]).toEqual([42, 30]);

        act(() => playback().toggle());

        expect(a).toMatchObject({ currentTime: 0, paused: false });
        expect(b).toMatchObject({ currentTime: 0, paused: false });
        expect(playback().playing).toBe(true);
    });

    it("mutes and unmutes A alone, and keeps B muted", () => {
        const { a, b, playback } = setup({ a: 42, b: 42 });

        act(() => playback().toggleMute());

        expect(a.muted).toBe(false);
        expect(b.muted).toBe(true);
        expect(playback().muted).toBe(false);

        act(() => {
            b.muted = false;
        });

        expect(b.muted).toBe(true);

        act(() => playback().toggleMute());

        expect(a.muted).toBe(true);
        expect(playback().muted).toBe(true);
    });

    it.each(["a", "b"] as const)("fails, stops playing and pauses both on an error on %s", (slot) => {
        const elements = setup({ a: 42, b: 42 });
        act(() => elements.playback().toggle());

        fireEvent.error(elements[slot]);

        expect(elements.playback()).toMatchObject({ failed: true, playing: false });
        expect([elements.a.paused, elements.b.paused]).toEqual([true, true]);
    });
});
