import { useState } from "react";
import { MediaKindIcon } from "@/components/MediaKindIcon";
import type { MediaType } from "@/ipc/formats";
import { renditionUrl } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";

/** A light sweeping across a dark placeholder, while something loads. */
export const SHIMMER =
    "animate-shimmer bg-[linear-gradient(90deg,#1F1F23_0%,#2E2E33_50%,#1F1F23_100%)] bg-size-[200%_100%] motion-reduce:animate-none";

/**
 * The longest edge, in pixels, a gallery or group tile's picture is asked for. A 160×120 tile on a 2× display needs 320×240 covered,
 * which a 16:9 or 3:4 picture fitted to 512 does.
 */
export const TILE_BOUND = 512;

type ThumbnailProps = {
    type: MediaType;
    /** The file's identity, which names its rendition; without one, the icon of its kind is shown. */
    identity?: string;
    /** The longest edge, in pixels, the picture is asked for. */
    bound: number;
    /** What shows while the picture loads: a shimmer, or the icon of the file's kind. */
    placeholder?: "shimmer" | "icon";
    /** The size of the icon of the file's kind. */
    iconClassName?: string;
};

/**
 * A file's picture covering its positioned parent: a shimmer or its kind's icon while it loads, the icon of its kind
 * if it can't be produced. Key it by the identity, so a picture that failed doesn't hide the next one.
 */
export const Thumbnail = ({
    type,
    identity,
    bound,
    placeholder = "shimmer",
    iconClassName = "[&_svg]:size-[22px]",
}: ThumbnailProps) => {
    const [state, setState] = useState<"loading" | "loaded" | "failed">(identity ? "loading" : "failed");
    const icon = state === "failed" || (state === "loading" && placeholder === "icon");

    return (
        <>
            {state === "loading" && placeholder === "shimmer" && (
                <span data-testid="shimmer" className={cn("absolute inset-0", SHIMMER)} />
            )}
            {icon && (
                <span
                    className={cn(
                        "absolute inset-0 flex items-center justify-center text-muted-foreground",
                        iconClassName,
                    )}
                >
                    <MediaKindIcon type={type} />
                </span>
            )}
            {identity && (
                // Decorative: the tile is named after the file.
                <img
                    alt=""
                    src={renditionUrl(identity, bound)}
                    decoding="async"
                    onLoad={() => setState("loaded")}
                    onError={() => setState("failed")}
                    className={cn("absolute inset-0 size-full object-cover", state !== "loaded" && "invisible")}
                />
            )}
        </>
    );
};
