import { useState } from "react";
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
};

/**
 * The file's whole picture, scaled to fit and centred, over its kind icon. The icon shows until the picture has
 * loaded, and stays when it can't be produced. A video's picture is a still frame; nothing plays.
 */
export const Picture = ({ file, className }: PictureProps) => {
    const [loaded, setLoaded] = useState(false);

    return (
        <div className={cn("relative", className)}>
            {!loaded && (
                <span className="absolute inset-0 flex items-center justify-center text-muted-foreground [&_svg]:size-8">
                    {file.type === "video" ? <VideoIcon aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
                </span>
            )}
            {/* Decorative: the header names the file. */}
            <img
                alt=""
                src={renditionUrl(file.identity, PICTURE_BOUND)}
                onLoad={() => setLoaded(true)}
                onError={() => setLoaded(false)}
                className={cn("absolute inset-0 size-full object-contain", !loaded && "invisible")}
            />
        </div>
    );
};
