import { useEffect, useState } from "react";
import { type MediaFormat, type MediaType, supportedFormats } from "@/ipc/formats";

/** `JPG (JPEG)`: the canonical extension, then the others in parentheses. */
const label = ({ extensions: [canonical = "", ...others] }: MediaFormat) => {
    const upper = canonical.toUpperCase();
    return others.length === 0 ? upper : `${upper} (${others.map((ext) => ext.toUpperCase()).join(", ")})`;
};

const FormatGroup = ({ label, formats }: { label: string; formats: string[] }) => (
    <span>
        <span className="text-foreground">{label}</span> {formats.join(" · ")}
    </span>
);

/** The supported media formats, below the mode cards, as `mediasim` lists them. */
export const FormatsFooter = () => {
    const [formats, setFormats] = useState<MediaFormat[]>([]);

    useEffect(() => {
        let mounted = true;
        supportedFormats().then(
            (listed) => mounted && setFormats(listed),
            (error: unknown) => console.error("could not list the supported formats", error),
        );
        return () => {
            mounted = false;
        };
    }, []);

    const labels = (type: MediaType) => formats.filter((format) => format.type === type).map(label);

    return (
        <p className="flex items-center gap-3.5 font-mono text-muted-foreground text-xs">
            <FormatGroup label="Images:" formats={labels("image")} />
            <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border-strong" />
            <FormatGroup label="Videos:" formats={labels("video")} />
        </p>
    );
};
