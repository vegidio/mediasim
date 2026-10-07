import { useState } from "react";
import { PlayIcon } from "lucide-react";
import { MediaKindIcon } from "@/components/MediaKindIcon";
import { type MediaFile, renditionUrl } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { stripWindow } from "./navigate";

/** The longest edge, in pixels, a strip thumbnail is asked for: a 96×72 thumbnail on a 2× display, covered. */
export const STRIP_BOUND = 256;

type StripThumbProps = {
    file: MediaFile;
    current: boolean;
    onShow: () => void;
};

/** One file of the strip: its picture, or its kind icon until it loads or when it can't be produced. */
const StripThumb = ({ file, current, onShow }: StripThumbProps) => {
    const [loaded, setLoaded] = useState(false);

    return (
        <button
            type="button"
            aria-label={`Show ${file.name}`}
            {...(current && { "aria-current": "true" })}
            onClick={onShow}
            className={cn(
                "relative h-[72px] w-24 shrink-0 overflow-hidden rounded-lg bg-[#18181B] outline-none focus-visible:ring-2 focus-visible:ring-primary",
                current ? "shadow-[0_0_0_2px_#BEF264]" : "opacity-70",
            )}
        >
            {!loaded && (
                <span className="absolute inset-0 flex items-center justify-center text-muted-foreground [&_svg]:size-4">
                    <MediaKindIcon type={file.type} />
                </span>
            )}
            {/* Decorative: the button is named after the file. */}
            <img
                alt=""
                src={renditionUrl(file.identity, STRIP_BOUND)}
                decoding="async"
                onLoad={() => setLoaded(true)}
                onError={() => setLoaded(false)}
                className={cn("absolute inset-0 size-full object-cover", !loaded && "invisible")}
            />
            {!current && (
                <span className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
            )}
            {file.type === "video" && (
                <span className="absolute right-1 bottom-1 flex size-[18px] items-center justify-center rounded-full bg-[rgba(9,9,11,0.75)]">
                    <PlayIcon aria-hidden="true" className="size-[9px] fill-[#FAFAFA] stroke-none" />
                </span>
            )}
        </button>
    );
};

type FilmstripProps = {
    files: readonly MediaFile[];
    /** The index of the file the dialog shows. */
    index: number;
    onShow: (file: MediaFile) => void;
};

/** Up to 7 of the gallery's files around the one shown, which is ringed in lime. */
export const Filmstrip = ({ files, index, onShow }: FilmstripProps) => {
    const { start, end } = stripWindow(files.length, index);

    return (
        <div className="box-border flex h-[116px] shrink-0 items-center justify-center gap-3 border-[#1F1F23] border-t bg-[#0A0A0C] px-4">
            {files.slice(start, end).map((file, offset) => (
                <StripThumb
                    key={file.path}
                    file={file}
                    current={start + offset === index}
                    onShow={() => onShow(file)}
                />
            ))}
        </div>
    );
};
