import { Picture } from "@/features/pair/Picture";
import { VideoPlayer } from "@/features/pair/VideoPlayer";
import type { MediaFile } from "@/ipc/thumbs";

type DetailsStageProps = {
    file: MediaFile;
    /** Told the picture's width over its height once it loads. */
    onRatio?: (ratio?: number) => void;
};

/**
 * The file's whole picture on black, filling the box the dialog sizes. A video plays in place with the pair screen's
 * player bar, at once and with its sound on. Keyed per file, so stepping away from a playing video stops it, and each
 * picture starts loading afresh.
 */
export const DetailsStage = ({ file, onRatio }: DetailsStageProps) => (
    <div data-testid="details-stage" className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {file.type === "video" ? (
            <VideoPlayer
                key={file.identity}
                file={file}
                autoPlay
                sound
                className="size-full"
                {...(onRatio && { onRatio })}
            />
        ) : (
            <Picture key={file.identity} file={file} className="size-full" {...(onRatio && { onRatio })} />
        )}
    </div>
);
