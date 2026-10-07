import type { Ref } from "react";
import { cn } from "@/lib/utils";

type PlayerVideoProps = {
    ref: Ref<HTMLVideoElement>;
    /** Whether the video shows; while it doesn't, it keeps its place, so whatever is under it shows instead. */
    visible: boolean;
};

/** A player's `<video>`, fitted whole into its picture's rectangle; it starts muted and loads only its metadata. */
export const PlayerVideo = ({ ref, visible }: PlayerVideoProps) => (
    <video
        ref={ref}
        muted
        playsInline
        preload="metadata"
        className={cn("absolute inset-0 size-full object-contain", !visible && "invisible")}
    />
);
