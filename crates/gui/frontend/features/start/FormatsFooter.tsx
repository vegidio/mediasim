// Static until slice 2 derives these from what `mediasim` loads.
const IMAGES = ["BMP", "GIF", "JPG (JPEG)", "PNG", "TIFF", "WebP", "AVIF", "HEIC", "HEIF"];
const VIDEOS = ["AVI", "MP4 (M4V)", "MKV", "MOV", "WebM", "WMV"];

const FormatGroup = ({ label, formats }: { label: string; formats: string[] }) => (
    <span>
        <span className="text-foreground">{label}</span> {formats.join(" · ")}
    </span>
);

/** The supported media formats, below the mode cards. */
export const FormatsFooter = () => (
    <p className="flex items-center gap-3.5 font-mono text-muted-foreground text-xs">
        <FormatGroup label="Images:" formats={IMAGES} />
        <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border-strong" />
        <FormatGroup label="Videos:" formats={VIDEOS} />
    </p>
);
