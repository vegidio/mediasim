import type { Ref } from "react";
import { cn } from "@/lib/utils";

type PlayerVideoProps = {
    ref: Ref<HTMLVideoElement>;
    /** Whether the video shows; while it doesn't, it keeps its place, so whatever is under it shows instead. */
    visible: boolean;
    /** Whether it plays as soon as it can, and again whenever its source is replaced, as by a fallback. */
    autoPlay?: boolean;
    /** Whether it starts with its sound on; it starts muted otherwise. */
    sound?: boolean;
};

/**
 * A player's `<video>`, fitted whole into its picture's rectangle; it starts muted unless asked for `sound`, and loads
 * only its metadata unless it plays at once.
 */
export const PlayerVideo = ({ ref, visible, autoPlay = false, sound = false }: PlayerVideoProps) => (
    <video
        ref={ref}
        muted={!sound}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        className={cn("absolute inset-0 size-full object-contain", !visible && "invisible")}
    />
);
