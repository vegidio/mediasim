import { type Ref, useRef, useState } from "react";
import { FilmIcon, FolderIcon, ImageIcon, LoaderCircleIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    AddToSetMenu,
    anchorFor,
    type Point,
    pickFilesIntoSet,
    pickFoldersIntoSet,
} from "@/features/home/AddToSetMenu";
import { formatCount, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type SourceRow, useHomeStore } from "@/stores/home";

/** What a row says under its name: a status alone, or a location and what the source holds. */
const detailsOf = (row: SourceRow): { location?: string; summary: string } => {
    if (row.pending) return { summary: "Counting…" };
    if (row.unreadable) return { summary: "Can't read this folder" };
    if (row.kind === "folder") {
        return { location: row.location, summary: ` · ${formatCount(row.count)} · ${formatSize(row.size)}` };
    }
    return { location: row.location, summary: ` · ${formatSize(row.size)}` };
};

/** The details line. A long location is what gets cut, so the count and size always stay readable. */
const Details = ({ row }: { row: SourceRow }) => {
    const { location, summary } = detailsOf(row);

    return (
        <span className="flex min-w-0 whitespace-pre font-mono text-muted-foreground text-xs">
            {location && <span className="truncate">{location}</span>}
            <span className="shrink-0">{summary}</span>
        </span>
    );
};

const RowIcon = ({ row }: { row: SourceRow }) => {
    if (row.pending) return <LoaderCircleIcon aria-hidden="true" className="animate-spin" />;
    if (row.kind === "folder") return <FolderIcon aria-hidden="true" />;
    if (row.kind === "video") return <FilmIcon aria-hidden="true" />;
    return <ImageIcon aria-hidden="true" />;
};

/** One source: its icon, name and details, and a button that removes it. */
const SetRow = ({ row }: { row: SourceRow }) => {
    const remove = useHomeStore((state) => state.remove);

    return (
        <li className="flex items-center gap-3 border-border-subtle border-b py-2.5 pr-2.5 pl-3.5">
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-primary [&_svg]:size-[18px]">
                <RowIcon row={row} />
            </span>
            <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="truncate font-medium text-sm">{row.name}</span>
                <Details row={row} />
            </span>
            <Button
                variant="ghost"
                aria-label={`Remove ${row.name}`}
                onClick={() => remove(row.path)}
                className="size-[30px] p-0 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
            >
                <XIcon aria-hidden="true" />
            </Button>
        </li>
    );
};

type SetListProps = {
    /** The list's box, which is the set card's drop target while the set has sources. */
    ref?: Ref<HTMLDivElement>;
    /** Whether something is being dragged over the box. */
    highlighted?: boolean;
    /** Called once Clear all has emptied the set, which unmounts the list. */
    onCleared?: () => void;
};

/**
 * The set's sources, in the order they were added, above a pinned row that opens the "Add to set" menu or clears the
 * set.
 */
export const SetList = ({ ref, highlighted = false, onCleared }: SetListProps) => {
    const sources = useHomeStore((state) => state.sources);
    const clear = useHomeStore((state) => state.clear);
    const addMoreRef = useRef<HTMLButtonElement>(null);
    const [menuAnchor, setMenuAnchor] = useState<Point>();

    return (
        <div
            ref={ref}
            className={cn(
                "flex h-[210px] shrink-0 flex-col overflow-hidden rounded-[10px] border-[1.5px] border-border-strong bg-surface-sunken transition-colors",
                highlighted && "border-border-hover bg-card",
            )}
        >
            <ul aria-label="Selected sources" className="min-h-0 flex-1 overflow-y-auto">
                {sources.map((row) => (
                    <SetRow key={row.path} row={row} />
                ))}
            </ul>
            <div className="relative flex h-10 shrink-0 border-border border-t border-dashed">
                <button
                    ref={addMoreRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={!!menuAnchor}
                    onClick={(event) => setMenuAnchor(anchorFor(event))}
                    className="flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:text-foreground [&_svg]:size-3.5"
                >
                    <PlusIcon aria-hidden="true" />
                    <span>Drop or click to add more files or folders</span>
                </button>
                <span aria-hidden="true" className="my-2.5 w-px shrink-0 bg-border" />
                <button
                    type="button"
                    onClick={() => {
                        void clear();
                        onCleared?.();
                    }}
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap px-3.5 font-medium text-danger-bright text-[13px] outline-none transition-colors hover:text-danger-soft focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5"
                >
                    <Trash2Icon aria-hidden="true" />
                    <span>Clear all</span>
                </button>
                <AddToSetMenu
                    {...(menuAnchor && { anchor: menuAnchor })}
                    onClose={() => setMenuAnchor(undefined)}
                    returnFocusTo={addMoreRef}
                    onPickFiles={pickFilesIntoSet}
                    onPickFolders={pickFoldersIntoSet}
                />
            </div>
        </div>
    );
};
