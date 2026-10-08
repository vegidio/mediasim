import type { GroupFile } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { groupSize } from "./format";
import { GroupTile } from "./GroupTile";

/** The number of files from which a group spans the full width: the fewest whose small tiles overflow a 1280 px window. */
export const LARGE_GROUP = 7;

/** A group as its card shows it. */
export type GroupView = {
    files: readonly GroupFile[];
    /** The index of the best file in `files`. */
    best: number;
    /** `scores[i]` is the similarity of `files[i]` to the best file. */
    scores: readonly number[];
};

type GroupCardProps = {
    /** The group's number, from 1. */
    number: number;
    group: GroupView;
    /** The scanned files by path, for their thumbnails. */
    media: ReadonlyMap<string, MediaFile>;
};

/** One group of similar files: its number and size, then its files, in a row or, from 7 files, in an 8-column grid. */
export const GroupCard = ({ number, group: { files, best, scores }, media }: GroupCardProps) => {
    const large = files.length >= LARGE_GROUP;
    const type = files[0]?.type ?? "image";

    return (
        <section
            aria-label={`Group ${number}`}
            className={cn(
                "flex flex-col gap-3.5 rounded-[14px] border border-[#27272A] bg-[#111113] px-5 pt-4 pb-5",
                large && "w-full",
            )}
        >
            <div className="flex items-center gap-2.5">
                <span className="font-semibold text-sm">Group {number}</span>
                <span className="text-[#A1A1AA] text-[13px]">{groupSize(files.length, type)}</span>
            </div>
            <div className={cn(large ? "grid grid-cols-8 gap-x-3 gap-y-4" : "flex gap-3")}>
                {files.map((file, index) => {
                    const identity = media.get(file.path)?.identity;
                    return (
                        <GroupTile
                            key={file.path}
                            file={file}
                            {...(identity && { identity })}
                            best={index === best}
                            score={scores[index] ?? 0}
                            large={large}
                        />
                    );
                })}
            </div>
        </section>
    );
};
