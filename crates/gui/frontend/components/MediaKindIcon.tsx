import { ImageIcon, VideoIcon } from "lucide-react";
import type { MediaType } from "@/ipc/formats";

type MediaKindIconProps = {
    type: MediaType;
    className?: string;
};

/** The icon for a file's kind, a film for a video and a picture for an image. Decorative: hidden from assistive tech. */
export const MediaKindIcon = ({ type, className }: MediaKindIconProps) => {
    const Icon = type === "video" ? VideoIcon : ImageIcon;
    return <Icon aria-hidden="true" className={className} />;
};
