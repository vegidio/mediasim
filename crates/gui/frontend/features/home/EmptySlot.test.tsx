import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { pickFile } from "@/ipc/dialog";
import { supportedFormats } from "@/ipc/formats";
import { usePairStore } from "@/stores/pair";
import { EmptySlot } from "./EmptySlot";

vi.mock("@/ipc/dialog", () => ({ pickFile: vi.fn() }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn() }));

const FORMATS = [{ type: "image", extensions: ["jpg"] }];

const mockedPickFile = pickFile as Mock;

describe("EmptySlot", () => {
    const place = vi.fn(() => Promise.resolve());

    beforeEach(() => {
        usePairStore.setState({ place });
        (supportedFormats as Mock).mockResolvedValue(FORMATS);
    });

    it("is an operable button named after its slot", () => {
        render(<EmptySlot slot="b" />);

        const slot = screen.getByRole("button", { name: "File B" });

        expect(slot).toHaveAccessibleDescription("Drop or click to choose");
        expect(slot).toBeEnabled();
    });

    it("opens the picker with the supported formats and places the picked file", async () => {
        mockedPickFile.mockResolvedValue("/IMG_2041.jpg");
        render(<EmptySlot slot="a" />);

        fireEvent.click(screen.getByRole("button", { name: "File A" }));

        await waitFor(() => expect(place).toHaveBeenCalledExactlyOnceWith("a", "/IMG_2041.jpg"));
        expect(mockedPickFile).toHaveBeenCalledExactlyOnceWith(FORMATS);
    });

    it("places nothing when the picker is cancelled", async () => {
        mockedPickFile.mockResolvedValue(undefined);
        render(<EmptySlot slot="a" />);

        fireEvent.click(screen.getByRole("button", { name: "File A" }));

        await waitFor(() => expect(mockedPickFile).toHaveBeenCalledOnce());
        await Promise.resolve();
        expect(place).not.toHaveBeenCalled();
    });

    it("applies the highlight while a drag would fill it", () => {
        const { rerender } = render(<EmptySlot slot="a" />);
        const slot = screen.getByRole("button", { name: "File A" });

        expect(slot).not.toHaveClass("bg-card");

        rerender(<EmptySlot slot="a" highlighted />);
        expect(slot).toHaveClass("border-border-hover", "bg-card");
    });
});
