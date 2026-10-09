import { PlayIcon, Trash2Icon } from "lucide-react";
import { Thumbnail } from "@/components/Thumbnail";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { stripWindow } from "./navigate";

/** The longest edge, in pixels, a strip thumbnail is asked for: a 96×72 thumbnail on a 2× display, covered. */
const STRIP_BOUND = 256;

type StripThumbProps = {
    file: MediaFile;
    current: boolean;
    /** Whether the file is marked for deletion, which shows the wash and the trash icon, and a red ring unless current. */
    marked: boolean;
    /** Whether the file is out of the comparison, which fades its picture as the gallery's tile does. */
    dimmed: boolean;
    onShow: () => void;
};

/** One file of the strip: its picture, or its kind icon until it loads or when it can't be produced. */
const StripThumb = ({ file, current, marked, dimmed, onShow }: StripThumbProps) => (
    <button
        type="button"
        aria-label={`Show ${file.name}${marked ? ", marked for deletion" : ""}`}
        {...(current && { "aria-current": "true" })}
        onClick={onShow}
        className={cn(
            "relative h-[72px] w-24 shrink-0 overflow-hidden rounded-lg bg-[#18181B] outline-none focus-visible:ring-2 focus-visible:ring-primary",
            current ? "shadow-[0_0_0_2px_#BEF264]" : marked ? "shadow-[0_0_0_2px_#EF4444]" : "opacity-70",
        )}
    >
        {/* Only the picture is faded, so the ring stays bright. */}
        <span data-testid="strip-picture" className={cn("absolute inset-0", dimmed && "opacity-28 grayscale")}>
            <Thumbnail
                key={file.identity}
                type={file.type}
                identity={file.identity}
                bound={STRIP_BOUND}
                placeholder="icon"
                iconClassName="[&_svg]:size-4"
            />
        </span>
        {!current && !marked && (
            <span className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
        )}
        {marked && (
            <span
                data-testid="strip-marked"
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(69,10,10,0.6)]"
            >
                <Trash2Icon aria-hidden="true" className="size-4 text-white" strokeWidth={2} />
            </span>
        )}
        {file.type === "video" && (
            <span className="absolute right-1 bottom-1 flex size-[18px] items-center justify-center rounded-full bg-[rgba(9,9,11,0.75)]">
                <PlayIcon aria-hidden="true" className="size-[9px] fill-[#FAFAFA] stroke-none" />
            </span>
        )}
    </button>
);

type FilmstripProps = {
    files: readonly MediaFile[];
    /** The index of the file the dialog shows. */
    index: number;
    onShow: (file: MediaFile) => void;
    /** The paths of the files marked for deletion. */
    marks?: ReadonlySet<string>;
    /** Whether `file` is out of the comparison, which fades its thumbnail; none is when left out. */
    isDimmed?: (file: MediaFile) => boolean;
};

/**
 * Up to 7 of `files` around the one shown, which is ringed in lime, with the marked ones washed in red and the ones out
 * of the comparison faded.
 */
export const Filmstrip = ({ files, index, onShow, marks, isDimmed }: FilmstripProps) => {
    const { start, end } = stripWindow(files.length, index);

    return (
        <div className="box-border flex h-[116px] shrink-0 items-center justify-center gap-3 border-[#1F1F23] border-t bg-[#0A0A0C] px-4">
            {files.slice(start, end).map((file, offset) => (
                <StripThumb
                    key={file.path}
                    file={file}
                    current={start + offset === index}
                    marked={marks?.has(file.path) ?? false}
                    dimmed={isDimmed?.(file) ?? false}
                    onShow={() => onShow(file)}
                />
            ))}
        </div>
    );
};
