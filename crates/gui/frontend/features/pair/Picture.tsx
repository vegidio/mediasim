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
};

/**
 * The file's whole picture, scaled to fit and centred, over its kind icon. The icon shows until the picture has
 * loaded, and stays when it can't be produced. A video's picture is a still frame; nothing plays.
 */
export const Picture = ({ file, className, overlay }: PictureProps) => {
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
                {loaded && overlay}
            </div>
        </div>
    );
};
