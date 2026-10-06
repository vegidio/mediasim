import { type ReactNode, useState } from "react";
import { ImageIcon, VideoIcon } from "lucide-react";
import { type MediaFile, renditionUrl } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";

/**
 * The longer edge of a pair's pictures. A maximized pane on a 2560-wide display at 2× is about 2460×1600 device px,
 * which this covers within 20%; asking one size always keeps one cached rendition per file whatever the window's size.
 */
export const PICTURE_BOUND = 2048;

type PictureProps = {
    file: MediaFile;
    className?: string;
    /** Drawn over the picture's own rectangle, not the box around it, and only once the picture has loaded. */
    overlay?: ReactNode;
    /** Drawn in the picture's own rectangle, over the picture and under `overlay`, whether it has loaded or not. */
    media?: ReactNode;
    /**
     * Drawn above everything, along the picture's bottom edge, 12 px inside it, but never narrower than 280 px or the
     * box, whichever is less. Along the box's bottom edge until the picture's shape is known.
     */
    bar?: ReactNode;
};

/** Where `bar` sits once the picture's shape is known, from the same `cq` arithmetic as the frame. */
const barStyle = (ratio: number) => ({
    width: `clamp(min(280px, 100cqw), min(100cqw, ${ratio} * 100cqh) - 24px, 100cqw)`,
    bottom: `calc((100cqh - min(100cqh, 100cqw / ${ratio})) / 2 + 12px)`,
});

/**
 * The file's whole picture, scaled to fit and centred, over its kind icon. The icon shows until the picture has
 * loaded, and stays when it can't be produced. A video's picture is a still frame, which `media` can draw a player
 * over.
 */
export const Picture = ({ file, className, overlay, media, bar }: PictureProps) => {
    const [loaded, setLoaded] = useState(false);
    /** The picture's width over its height, known once it has loaded. */
    const [ratio, setRatio] = useState<number>();

    return (
        // A size container, so the frame below can fit itself with `cq` units rather than measuring.
        <div className={cn("relative [container-type:size]", className)}>
            {!loaded && (
                <span className="absolute inset-0 flex items-center justify-center text-muted-foreground [&_svg]:size-8">
                    {file.type === "video" ? <VideoIcon aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
                </span>
            )}
            {/*
             * The picture's own rectangle, centred. The whole box until its shape is known, or where a webview can't
             * read `cq` units and drops the inline size.
             */}
            <div
                data-testid="picture-frame"
                style={
                    ratio
                        ? { width: `min(100cqw, ${ratio} * 100cqh)`, height: `min(100cqh, 100cqw / ${ratio})` }
                        : undefined
                }
                className="absolute top-1/2 left-1/2 size-full -translate-x-1/2 -translate-y-1/2"
            >
                {/* Decorative: the header names the file. */}
                <img
                    alt=""
                    src={renditionUrl(file.identity, PICTURE_BOUND)}
                    onLoad={(event) => {
                        const { naturalWidth, naturalHeight } = event.currentTarget;
                        setRatio(naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : undefined);
                        setLoaded(true);
                    }}
                    onError={() => {
                        setRatio(undefined);
                        setLoaded(false);
                    }}
                    className={cn("absolute inset-0 size-full object-contain", !loaded && "invisible")}
                />
                {media}
                {loaded && overlay}
            </div>
            {/*
             * Outside the frame, so a narrow portrait picture still gets a usable bar. The class places it where a
             * webview can't read `cq` units and drops the inline style.
             */}
            {bar && (
                <div
                    data-testid="picture-bar"
                    style={ratio ? barStyle(ratio) : undefined}
                    className="absolute bottom-3 left-1/2 w-[max(calc(100%-24px),min(280px,100%))] max-w-full -translate-x-1/2"
                >
                    {bar}
                </div>
            )}
        </div>
    );
};
