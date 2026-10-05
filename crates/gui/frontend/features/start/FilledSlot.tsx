import { useState } from "react";
import { ImageIcon, VideoIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { slotLabel } from "@/features/start/EmptySlot";
import { formatSize } from "@/features/start/format";
import type { Slot } from "@/features/start/routePairDrop";
import { type MediaFile, renditionUrl } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { usePairStore } from "@/stores/pair";

/**
 * The longer edge of a slot's picture. A slot is about 236×210 CSS px at the window's minimum width, so a 16:9 frame
 * covering it on a 2× display needs about 747 px of width.
 */
const THUMBNAIL_BOUND = 768;

/**
 * The file's picture covering the slot, over its kind icon. The icon shows until the picture has loaded, and stays
 * when it can't be produced.
 */
const Thumbnail = ({ file }: { file: MediaFile }) => {
    const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
    const loaded = state === "loaded";

    return (
        <>
            {!loaded && (
                <span className="absolute inset-0 flex items-center justify-center bg-surface-sunken text-muted-foreground [&_svg]:size-[22px]">
                    {file.type === "video" ? <VideoIcon aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
                </span>
            )}
            {/* Decorative: the bar names the file. */}
            <img
                alt=""
                src={renditionUrl(file.identity, THUMBNAIL_BOUND)}
                onLoad={() => setState("loaded")}
                onError={() => setState("failed")}
                className={cn("absolute inset-0 size-full object-cover", !loaded && "invisible")}
            />
        </>
    );
};

type FilledSlotProps = {
    slot: Slot;
    file: MediaFile;
    /** Whether a drag over the card would replace this slot's file. */
    highlighted?: boolean;
    /** Called once the file has been removed, as the slot turns empty. */
    onRemove?: () => void;
};

/** A slot holding a file: its picture, the slot's badge, a remove button, and a bar with the file's name and size. */
export const FilledSlot = ({ slot, file, highlighted = false, onRemove }: FilledSlotProps) => {
    const remove = usePairStore((state) => state.remove);
    const badge = slot.toUpperCase();

    return (
        // A fieldset is a group named by its label; `min-w-0` undoes its `min-content` width, which would stop truncation.
        <fieldset
            aria-label={slotLabel(slot)}
            className={cn(
                "relative h-[210px] w-full min-w-0 overflow-hidden rounded-[10px] border-[1.5px] border-border bg-surface-sunken transition-colors",
                highlighted && "border-border-hover bg-card",
            )}
        >
            {/* Keyed so a replaced file starts loading afresh rather than showing as loaded. */}
            <Thumbnail key={file.identity} file={file} />
            {/* One row, so the badge and the taller remove button share a vertical centre. */}
            <div className="absolute inset-x-2.5 top-2.5 flex items-center justify-between">
                <span className="rounded-md bg-[rgba(9,9,11,0.78)] px-2 py-0.5 font-semibold text-foreground text-xs">
                    {badge}
                </span>
                <Button
                    variant="ghost"
                    aria-label={`Remove file ${badge}`}
                    onClick={() => {
                        remove(slot);
                        onRemove?.();
                    }}
                    className="size-7 rounded-full bg-[rgba(9,9,11,0.78)] p-0 text-foreground [&_svg:not([class*='size-'])]:size-3.5"
                >
                    <XIcon aria-hidden="true" />
                </Button>
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-[rgba(9,9,11,0.82)] px-3 py-2 text-xs">
                <span title={file.name} className="truncate font-mono text-foreground">
                    {file.name}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
            </div>
        </fieldset>
    );
};
