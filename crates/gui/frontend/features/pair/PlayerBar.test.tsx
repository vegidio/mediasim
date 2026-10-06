import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlayerBar } from "./PlayerBar";
import type { VideoPlayback } from "./useVideoPlayback";

const NAME = "VID_0714.mov";

const playback = (state: Partial<VideoPlayback> = {}): VideoPlayback => ({
    playing: false,
    time: 0,
    muted: true,
    started: false,
    failed: false,
    toggle: vi.fn(),
    seek: vi.fn(),
    toggleMute: vi.fn(),
    ...state,
});

const player = () => screen.getByRole("group", { name: `Player for ${NAME}` });
const seekBar = () => screen.getByRole("slider", { name: `Seek ${NAME}` });

describe("PlayerBar", () => {
    it("names its controls with the file, following the state", () => {
        const { rerender } = render(<PlayerBar name={NAME} playback={playback()} />);

        expect(screen.getByRole("button", { name: "Play VID_0714.mov" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Unmute VID_0714.mov" })).toBeInTheDocument();

        rerender(<PlayerBar name={NAME} playback={playback({ playing: true, muted: false })} />);

        expect(screen.getByRole("button", { name: "Pause VID_0714.mov" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Mute VID_0714.mov" })).toBeInTheDocument();
    });

    it("names the mute button with muteName when given, and every other control with name", () => {
        const { rerender } = render(<PlayerBar name="A and B" muteName="A" playback={playback({ duration: 42 })} />);

        expect(screen.getByRole("group", { name: "Player for A and B" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Play A and B" })).toBeInTheDocument();
        expect(screen.getByRole("slider", { name: "Seek A and B" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Unmute A" })).toBeInTheDocument();

        rerender(
            <PlayerBar
                name="A and B"
                muteName="A"
                playback={playback({ duration: 42, playing: true, muted: false })}
            />,
        );

        expect(screen.getByRole("button", { name: "Pause A and B" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Mute A" })).toBeInTheDocument();
    });

    it("holds play, the time, the seek bar and mute, in order, in a group named for the file", () => {
        render(<PlayerBar name={NAME} playback={playback({ time: 12.4, duration: 42.6 })} />);

        const [play, time, seek, mute] = player().children;
        expect(play).toHaveAccessibleName("Play VID_0714.mov");
        expect(time).toHaveTextContent(/^0:12 \/ 0:42$/);
        expect(seek).toContainElement(seekBar());
        expect(mute).toHaveAccessibleName("Unmute VID_0714.mov");
        expect(player().children).toHaveLength(4);
    });

    it("reads the time and the seek bar's value against the duration", () => {
        render(<PlayerBar name={NAME} playback={playback({ time: 12.4, duration: 42.6 })} />);

        expect(player()).toHaveTextContent("0:12 / 0:42");
        expect(seekBar()).toHaveAttribute("aria-valuetext", "0:12 of 0:42");
        expect(seekBar()).toHaveAttribute("aria-valuenow", "12.4");
        expect(seekBar()).toHaveAttribute("aria-valuemax", "42.6");
        expect(seekBar()).not.toHaveAttribute("data-disabled");
    });

    it("shows 0:00 / -:-- with the seek bar disabled until the duration is known", () => {
        render(<PlayerBar name={NAME} playback={playback()} />);

        expect(player()).toHaveTextContent("0:00 / -:--");
        expect(seekBar()).toHaveAttribute("aria-valuetext", "0:00 of -:--");
        expect(seekBar()).toHaveAttribute("data-disabled");
    });

    it("seeks with the arrow keys and the ends with Home and End", () => {
        const seek = vi.fn();
        render(<PlayerBar name={NAME} playback={playback({ time: 12, duration: 42, seek })} />);

        fireEvent.keyDown(seekBar(), { key: "ArrowRight" });
        fireEvent.keyDown(seekBar(), { key: "ArrowLeft" });
        fireEvent.keyDown(seekBar(), { key: "Home" });
        fireEvent.keyDown(seekBar(), { key: "End" });

        expect(seek.mock.calls).toEqual([[17], [7], [0], [42]]);
    });

    it("seeks to the point pressed on the seek bar", () => {
        const seek = vi.fn();
        render(<PlayerBar name={NAME} playback={playback({ time: 0, duration: 42, seek })} />);
        // The slider's root, which reads the press against its own box; jsdom lays nothing out and has no pointer capture.
        const track = seekBar().closest(".flex-1") as HTMLElement;
        track.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 0, width: 200, height: 44 });
        track.setPointerCapture = () => {};

        fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });

        expect(seek).toHaveBeenCalledExactlyOnceWith(21);
    });

    it("keeps an arrow key's seek within the video", () => {
        const seek = vi.fn();
        render(<PlayerBar name={NAME} playback={playback({ time: 40, duration: 42, seek })} />);

        fireEvent.keyDown(seekBar(), { key: "ArrowUp" });

        expect(seek).toHaveBeenCalledExactlyOnceWith(42);
    });

    it("calls toggle and toggleMute from its buttons", () => {
        const state = playback();
        render(<PlayerBar name={NAME} playback={state} />);

        fireEvent.click(screen.getByRole("button", { name: "Play VID_0714.mov" }));
        fireEvent.click(screen.getByRole("button", { name: "Unmute VID_0714.mov" }));

        expect(state.toggle).toHaveBeenCalledOnce();
        expect(state.toggleMute).toHaveBeenCalledOnce();
    });

    it("sets no aria-pressed", () => {
        render(<PlayerBar name={NAME} playback={playback({ playing: true })} />);

        for (const button of screen.getAllByRole("button")) {
            expect(button).not.toHaveAttribute("aria-pressed");
        }
    });

    it("shows a note and no controls when the video can't be played", () => {
        render(<PlayerBar name={NAME} playback={playback({ failed: true, duration: 42 })} />);

        expect(screen.getByText("Can't play this format yet")).toBeInTheDocument();
        expect(screen.queryByRole("group")).not.toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
        expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    });
});
