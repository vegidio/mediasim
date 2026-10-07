import { StrictMode, useRef } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { videoClose, videoNext, videoOpen } from "@/ipc/video";
import { mediaSources, revokedUrls, type StubMediaSource, type StubSourceBuffer } from "@/test/mediaSource";
import { H264_STAND_IN } from "./playChoice";
import { AHEAD, BEHIND, ENCODE_AHEAD, type MseSource, useMseSource } from "./useMseSource";

vi.mock("@/ipc/video", () => ({ videoOpen: vi.fn(), videoNext: vi.fn(), videoClose: vi.fn() }));

const mockedOpen = videoOpen as Mock;
const mockedNext = videoNext as Mock;
const mockedClose = videoClose as Mock;

/** The length of every fragment the mocked sessions return, in seconds. */
const FRAGMENT = 2;

const SOURCE: MseSource = {
    identity: "0123456789abcdef",
    duration: 120,
    plan: { video: "copy", audio: "copy", mime: 'video/mp4; codecs="avc1.640028,mp4a.40.2"', noSound: false },
};

/** A transcode: the video encoded, and DTS sound encoded to AAC. */
const TRANSCODE: MseSource = {
    ...SOURCE,
    plan: { video: "encode", audio: "encode", mime: `video/mp4; codecs="${H264_STAND_IN},mp4a.40.2"`, noSound: false },
};

const INIT = new ArrayBuffer(4);

/** A fragment the stub source buffer reads as `seconds` long. */
const fragment = (seconds = FRAGMENT) => {
    const bytes = new ArrayBuffer(8);
    new DataView(bytes).setFloat64(0, seconds);
    return bytes;
};

/** Sessions that answer an init segment, then `fragments` fragments, then empty segments. Ids count up from 1. */
const sessions = (fragments = Number.POSITIVE_INFINITY) => {
    const served = new Map<number, number>();
    let next = 1;
    mockedOpen.mockImplementation(async (_: string, at: number) => ({
        session: next++,
        start: Math.floor(at / FRAGMENT) * FRAGMENT,
    }));
    mockedNext.mockImplementation(async (session: number) => {
        const count = served.get(session) ?? 0;
        served.set(session, count + 1);
        if (count === 0) return INIT;
        return count <= fragments ? fragment() : new ArrayBuffer(0);
    });
    mockedClose.mockResolvedValue(undefined);
};

const Harness = ({ source }: { source?: MseSource }) => {
    const ref = useRef<HTMLVideoElement>(null);
    useMseSource(ref, source);
    return <video ref={ref} muted data-testid="video" />;
};

const mount = ({ strict = false, source = SOURCE } = {}) => {
    const harness = <Harness source={source} />;
    const view = render(strict ? <StrictMode>{harness}</StrictMode> : harness);
    return { ...view, video: view.getByTestId("video") as HTMLVideoElement };
};

const source = () => mediaSources.at(-1) as StubMediaSource;
const buffer = () => source().sourceBuffers[0] as StubSourceBuffer;
const ranges = () => {
    const { buffered } = buffer();
    return Array.from({ length: buffered.length }, (_, index) => [buffered.start(index), buffered.end(index)]);
};

/** Moves the playhead and lets the hook react, as playing to that point would. */
const playTo = async (video: HTMLVideoElement, time: number) => {
    act(() => {
        video.currentTime = time;
    });
    await act(async () => {});
};

/** Waits until the buffer reaches `end` seconds and the hook has stopped asking. */
const settled = async (end: number) => {
    await waitFor(() => expect(ranges().at(-1)?.[1]).toBe(end));
    await act(async () => {});
};

beforeEach(() => {
    mockedOpen.mockReset();
    mockedNext.mockReset();
    mockedClose.mockReset();
    sessions();
});

describe("useMseSource", () => {
    it("does nothing without a source", () => {
        const { getByTestId } = render(<Harness />);
        const video = getByTestId("video");

        expect(video).not.toHaveAttribute("src");
        expect(mediaSources).toHaveLength(0);
    });

    it("attaches an object URL, sets the duration, and appends the init segment then fragments", async () => {
        const { video } = mount();

        expect(video.getAttribute("src")).toMatch(/^blob:/);
        await settled(AHEAD);

        expect(source().duration).toBe(120);
        expect(buffer().mime).toBe(SOURCE.plan.mime);
        expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(SOURCE.identity, 0, { video: "copy", audio: "copy" });
        const [first, ...rest] = buffer().appended;
        expect(first).toBe(INIT);
        expect(rest).toHaveLength(AHEAD / FRAGMENT);
        expect(ranges()).toEqual([[0, AHEAD]]);
    });

    it("opens a transcode with the plan's modes, and stops asking once 10 s are buffered ahead", async () => {
        const { video } = mount({ source: TRANSCODE });
        await settled(ENCODE_AHEAD);
        const asked = mockedNext.mock.calls.length;

        act(() => {
            fireEvent(video, new Event("timeupdate"));
        });
        await act(async () => {});

        expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(SOURCE.identity, 0, { video: "encode", audio: "encode" });
        expect(buffer().mime).toBe(TRANSCODE.plan.mime);
        // The init segment, then five 2-second segments.
        expect(asked).toBe(1 + ENCODE_AHEAD / FRAGMENT);
        expect(mockedNext).toHaveBeenCalledTimes(asked);
        expect(ranges()).toEqual([[0, ENCODE_AHEAD]]);

        await playTo(video, 4);
        await settled(ENCODE_AHEAD + 4);
        expect(mockedNext).toHaveBeenCalledTimes(asked + 2);
    });

    it("closes a transcode's session on unmount, under StrictMode too", async () => {
        const { unmount } = mount({ strict: true, source: TRANSCODE });
        await settled(ENCODE_AHEAD);

        unmount();

        expect(mockedOpen).toHaveBeenCalledOnce();
        expect(mockedClose).toHaveBeenCalledExactlyOnceWith(1);
    });

    it("asks for no more once enough is buffered ahead, and for more as the playhead moves", async () => {
        const { video } = mount();
        await settled(AHEAD);
        const asked = mockedNext.mock.calls.length;

        act(() => {
            fireEvent(video, new Event("timeupdate"));
        });
        await act(async () => {});
        expect(mockedNext).toHaveBeenCalledTimes(asked);

        await playTo(video, 4);
        await settled(AHEAD + 4);
        expect(mockedNext).toHaveBeenCalledTimes(asked + 2);
    });

    it("removes what is far behind the playhead", async () => {
        const { video } = mount();
        await settled(AHEAD);

        await playTo(video, 20);
        await settled(AHEAD + 20);

        expect(ranges()).toEqual([[20 - BEHIND, AHEAD + 20]]);
    });

    it("reopens at the target on a seek outside what is buffered, placed at the session's start", async () => {
        const { video } = mount();
        await settled(AHEAD);

        act(() => {
            video.currentTime = 61;
            fireEvent(video, new Event("seeking"));
        });
        // At least 30 s past 61 s, in whole fragments from the keyframe at 60 s.
        await settled(92);

        expect(mockedClose).toHaveBeenCalledExactlyOnceWith(1);
        expect(mockedOpen).toHaveBeenLastCalledWith(SOURCE.identity, 61, { video: "copy", audio: "copy" });
        expect(buffer().timestampOffset).toBe(60);
        expect(ranges()).toEqual([[60, 92]]);
    });

    it("keeps the session on a seek within what is buffered", async () => {
        const { video } = mount();
        await settled(AHEAD);

        act(() => {
            video.currentTime = 12;
            fireEvent(video, new Event("seeking"));
        });
        await act(async () => {});

        expect(mockedOpen).toHaveBeenCalledOnce();
        expect(mockedClose).not.toHaveBeenCalled();
    });

    it("ends the stream on an empty segment", async () => {
        sessions(3);
        mount();

        await waitFor(() => expect(source().endings).toEqual([undefined]));
        expect(source().readyState).toBe("ended");
        expect(ranges()).toEqual([[0, 3 * FRAGMENT]]);
    });

    it("raises the element's error when the file is gone", async () => {
        mockedNext.mockImplementation(async () => {
            throw { kind: "gone" };
        });
        const { video } = mount();
        const failed = vi.fn();
        video.addEventListener("error", failed);

        await waitFor(() => expect(failed).toHaveBeenCalledOnce());
        expect(source().endings).toEqual(["decode"]);
    });

    it("raises the element's error when an append fails", async () => {
        const { video } = mount();
        const failed = vi.fn();
        video.addEventListener("error", failed);
        await settled(AHEAD);
        buffer().appendBuffer = () => {
            throw new DOMException("bad media", "InvalidStateError");
        };

        await playTo(video, 4);

        await waitFor(() => expect(failed).toHaveBeenCalledOnce());
        expect(mockedClose).toHaveBeenCalledWith(1);
    });

    it("shrinks the ahead target and evicts when the buffer is full", async () => {
        const { video } = mount();
        await settled(AHEAD);
        await playTo(video, 20);
        await settled(AHEAD + 20);

        buffer().quotaExceeded = true;
        await playTo(video, 24);
        await act(async () => {});

        // The retried fragment lands; nothing more is asked for until the playhead is within half the target.
        expect(ranges().at(-1)?.[1]).toBe(AHEAD + 22);
        expect(video.error).toBeNull();
    });

    it("closes the session, revokes the URL and clears the element on unmount", async () => {
        const { video, unmount } = mount();
        await settled(AHEAD);
        const url = video.getAttribute("src");

        unmount();

        expect(mockedClose).toHaveBeenCalledExactlyOnceWith(1);
        expect(revokedUrls).toEqual([url]);
        expect(video).not.toHaveAttribute("src");
    });

    it("opens one session under StrictMode, and closes it and revokes both URLs on unmount", async () => {
        const { unmount } = mount({ strict: true });
        await settled(AHEAD);

        expect(mockedOpen).toHaveBeenCalledOnce();
        expect(revokedUrls).toHaveLength(1);

        unmount();

        expect(mockedClose).toHaveBeenCalledExactlyOnceWith(1);
        expect(revokedUrls).toHaveLength(2);
    });
});
