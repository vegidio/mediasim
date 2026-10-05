import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFormat } from "@/ipc/formats";
import { FormatsFooter } from "./FormatsFooter";

// What `MediaFormat::all()` lists today; `crates/mediasim/src/media/kind.rs` tests the Rust side of it.
const FORMATS: MediaFormat[] = [
    { type: "image", extensions: ["bmp"] },
    { type: "image", extensions: ["gif"] },
    { type: "image", extensions: ["jpg", "jpeg"] },
    { type: "image", extensions: ["png"] },
    { type: "image", extensions: ["tiff", "tif"] },
    { type: "image", extensions: ["avif"] },
    { type: "image", extensions: ["heif", "heic"] },
    { type: "image", extensions: ["webp"] },
    ...["avi", "m4v", "mp4", "mkv", "mov", "webm", "wmv"].map(
        (ext): MediaFormat => ({ type: "video", extensions: [ext] }),
    ),
];

vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve(FORMATS)) }));

describe("FormatsFooter", () => {
    it("lists the supported image and video formats", async () => {
        render(<FormatsFooter />);

        expect(await screen.findByText(/BMP/)).toBeInTheDocument();
        expect(screen.getByText("Images:").parentElement).toHaveTextContent(
            "Images: BMP · GIF · JPG (JPEG) · PNG · TIFF (TIF) · AVIF · HEIF (HEIC) · WEBP",
        );
        expect(screen.getByText("Videos:").parentElement).toHaveTextContent(
            "Videos: AVI · M4V · MP4 · MKV · MOV · WEBM · WMV",
        );
    });

    it("shows both group labels before the formats arrive", () => {
        render(<FormatsFooter />);

        expect(screen.getByText("Images:")).toBeInTheDocument();
        expect(screen.getByText("Videos:")).toBeInTheDocument();
    });
});
