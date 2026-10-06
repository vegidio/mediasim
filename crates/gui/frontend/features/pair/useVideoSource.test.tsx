import { useRef } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useVideoSource } from "./useVideoSource";

const URL = "http://video.localhost/0123456789abcdef";

const Harness = () => {
    const ref = useRef<HTMLVideoElement>(null);
    useVideoSource(ref, URL);
    return <video ref={ref} muted data-testid="video" />;
};

describe("useVideoSource", () => {
    it("sets the element's source on mount", () => {
        const { getByTestId } = render(<Harness />);

        expect(getByTestId("video")).toHaveAttribute("src", URL);
    });

    it("pauses the element and clears its source on unmount", () => {
        const { getByTestId, unmount } = render(<Harness />);
        const video = getByTestId("video") as HTMLVideoElement;
        act(() => {
            video.play();
        });

        unmount();

        expect(video.paused).toBe(true);
        expect(video).not.toHaveAttribute("src");
    });
});
