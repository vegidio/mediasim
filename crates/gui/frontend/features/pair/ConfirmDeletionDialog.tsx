import { type ReactNode, useRef, useState } from "react";
import { ImageIcon, LoaderCircleIcon, Trash2Icon, VideoIcon } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Slot } from "@/features/start/routePairDrop";
import { type MediaFile, renditionUrl } from "@/ipc/thumbs";
import { formatSize } from "@/lib/format";
import { usePairResultStore } from "@/stores/pairResult";
import { DISMISS_ID } from "./DeletionNotice";

const SLOTS: readonly Slot[] = ["a", "b"];

/** Twice the 48×36 thumbnail's longer edge, for a sharp picture at 2×. */
const THUMB_BOUND = 96;

/** One file to delete: its thumbnail, or its kind icon when none can be produced, its name and its size. */
const Row = ({ file }: { file: MediaFile }) => {
    const [failed, setFailed] = useState(false);

    return (
        <li className="flex items-center gap-3 border-[#1F1F23] border-b px-3 py-2 last:border-b-0">
            <span className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#18181B] text-muted-foreground [&_svg]:size-4">
                {failed ? (
                    file.type === "video" ? (
                        <VideoIcon aria-hidden="true" />
                    ) : (
                        <ImageIcon aria-hidden="true" />
                    )
                ) : (
                    // Decorative: the name follows.
                    <img
                        alt=""
                        src={renditionUrl(file.identity, THUMB_BOUND)}
                        onError={() => setFailed(true)}
                        className="size-full object-cover"
                    />
                )}
            </span>
            <span title={file.name} className="min-w-0 flex-1 truncate font-mono text-xs">
                {file.name}
            </span>
            <span className="shrink-0 font-mono text-[#A1A1AA] text-xs">{formatSize(file.size)}</span>
        </li>
    );
};

type ConfirmDeletionDialogProps = {
    /** The button that opens the dialog, which focus returns to when it closes without moving anything. */
    children: ReactNode;
};

/**
 * Asks to confirm moving the marked files to the Trash, listing each with its thumbnail, name and size, then moves
 * them. Open while the pair result store's deletion isn't idle; it can't be closed by a press outside, nor at all
 * while the files are moving.
 */
export const ConfirmDeletionDialog = ({ children }: ConfirmDeletionDialogProps) => {
    const files = usePairResultStore((state) => state.files);
    const marked = usePairResultStore((state) => state.marked);
    const deletion = usePairResultStore((state) => state.deletion);
    const confirmDeletion = usePairResultStore((state) => state.confirmDeletion);
    const cancelDeletion = usePairResultStore((state) => state.cancelDeletion);
    const moveToTrash = usePairResultStore((state) => state.moveToTrash);
    /** Whether the dialog is closing after a move, rather than a cancel. */
    const moved = useRef(false);

    const moving = deletion.status === "moving";
    const chosen = files ? SLOTS.filter((slot) => marked[slot]).map((slot) => files[slot]) : [];

    // The files as confirmed, kept while closing: a move unmarks them, which would otherwise empty the list as it fades.
    const [listed, setListed] = useState<MediaFile[]>([]);
    if (
        deletion.status === "confirming" &&
        chosen.map(({ identity }) => identity).join() !== listed.map(({ identity }) => identity).join()
    ) {
        setListed(chosen);
    }

    const count = listed.length;
    const total = listed.reduce((sum, file) => sum + file.size, 0);
    const counted = count === 1 ? "1 file" : `${count} files`;

    return (
        <AlertDialog
            open={deletion.status !== "idle"}
            onOpenChange={(open) => (open ? confirmDeletion() : cancelDeletion())}
        >
            <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
            <AlertDialogContent
                onEscapeKeyDown={(event) => {
                    if (moving) event.preventDefault();
                }}
                onCloseAutoFocus={(event) => {
                    // After a move, the trigger is usually disabled, so focus goes to the notice reporting it.
                    if (!moved.current) return;
                    moved.current = false;
                    event.preventDefault();
                    document.getElementById(DISMISS_ID)?.focus();
                }}
                className="block w-[520px] max-w-[calc(100%-32px)] gap-0 rounded-[16px] border border-[#27272A] bg-[#0F0F11] p-0 shadow-[0_24px_64px_rgba(0,0,0,.6)] ring-0 data-[size=default]:max-w-[calc(100%-32px)] data-[size=default]:sm:max-w-[calc(100%-32px)]"
            >
                <div className="flex gap-3.5 px-6 pt-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(220,38,38,.14)]">
                        <Trash2Icon aria-hidden="true" className="size-5 text-[#F87171]" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                        <AlertDialogTitle className="font-semibold text-[18px]">
                            Move {counted} to Trash?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-[#A1A1AA] text-sm leading-normal">
                            You can restore {count === 1 ? "it" : "them"} from the Trash until it is emptied.
                        </AlertDialogDescription>
                    </div>
                </div>

                <div className="px-6 pt-5">
                    <ul
                        aria-label="Files to delete"
                        className="max-h-[252px] overflow-y-auto rounded-xl border border-[#27272A] bg-[#111113]"
                    >
                        {listed.map((file) => (
                            <Row key={file.identity} file={file} />
                        ))}
                    </ul>
                    <p className="mt-3 flex justify-between text-[#A1A1AA] text-[13px]">
                        <span>{counted}</span>
                        <span>
                            Total <span className="font-semibold text-[#FAFAFA]">{formatSize(total)}</span>
                        </span>
                    </p>
                </div>

                <div className="flex justify-end gap-2.5 px-6 pt-5 pb-6">
                    <AlertDialogCancel
                        disabled={moving}
                        className="h-10 rounded-lg border-[#3F3F46] px-4 font-medium text-sm dark:border-[#3F3F46]"
                    >
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={moving}
                        onClick={(event) => {
                            // Radix would close the dialog now; the store closes it once the move has finished.
                            event.preventDefault();
                            moved.current = true;
                            void moveToTrash();
                        }}
                        className="h-10 gap-2 rounded-lg bg-[#DC2626] px-[18px] font-semibold text-sm text-white hover:bg-[#B91C1C] disabled:bg-[#DC2626] disabled:text-white disabled:opacity-60"
                    >
                        {moving && (
                            <LoaderCircleIcon
                                aria-hidden="true"
                                className="size-4 animate-spin motion-reduce:animate-none"
                            />
                        )}
                        {moving ? "Moving…" : "Move to Trash"}
                    </AlertDialogAction>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};
