import { useMemo } from "react";
import { DeletionNotice, focusDismiss, type NoticeView } from "@/components/deletion/DeletionNotice";
import { undoable as undoableOf } from "@/lib/deletion";
import { usePairResultStore } from "@/stores/pairResult";

type PairDeletionNoticeProps = {
    className?: string;
};

/**
 * The deletion notice for the pair result store's last move, deletion or restore. Undo puts back the files that move
 * moved that are still in the Trash.
 */
export const PairDeletionNotice = ({ className }: PairDeletionNoticeProps) => {
    const files = usePairResultStore((state) => state.files);
    const notice = usePairResultStore((state) => state.notice);
    const dismissNotice = usePairResultStore((state) => state.dismissNotice);
    const gone = usePairResultStore((state) => state.gone);
    const restoring = usePairResultStore((state) => state.deletion.status === "restoring");
    const restore = usePairResultStore((state) => state.restore);

    // Built once per notice: a new view restarts the notice's timer and drops its hover and focus hold.
    const view = useMemo(
        (): NoticeView | undefined =>
            files && notice
                ? {
                      action: notice.action,
                      done: notice.done.map((slot) => files[slot]),
                      failed: notice.failed.map(({ key, message }) => ({ key, name: files[key].name, message })),
                  }
                : undefined,
        [files, notice],
    );

    const undoable = undoableOf(notice, (slot) => gone[slot] === "trash");

    return (
        <DeletionNotice
            {...(view && { notice: view })}
            undoCount={undoable.length}
            restoring={restoring}
            onUndo={() => restore(undoable).then(focusDismiss)}
            onDismiss={dismissNotice}
            {...(className && { className })}
        />
    );
};
