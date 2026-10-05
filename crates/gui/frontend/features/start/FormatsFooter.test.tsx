import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormatsFooter } from "./FormatsFooter";

describe("FormatsFooter", () => {
    it("lists the supported image and video formats", () => {
        render(<FormatsFooter />);

        expect(screen.getByText("Images:").parentElement).toHaveTextContent(
            "Images: BMP · GIF · JPG (JPEG) · PNG · TIFF · WebP · AVIF · HEIC · HEIF",
        );
        expect(screen.getByText("Videos:").parentElement).toHaveTextContent(
            "Videos: AVI · MP4 (M4V) · MKV · MOV · WebM · WMV",
        );
    });
});
