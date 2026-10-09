import { useMemo } from "react";
import {
    focusDismiss,
    type NoticeView,
    DeletionNotice as SharedDeletionNotice,
} from "@/components/deletion/DeletionNotice";
import { usePairResultStore } from "@/stores/pairResult";

export { DISMISS_ID, focusDismiss, HIDE_AFTER } from "@/components/deletion/DeletionNotice";

type DeletionNoticeProps = {
    className?: string;
};

/**
 * The deletion notice for the pair result store's last move, deletion or restore. Undo puts back the files that move
 * moved that are still in the Trash.
 */
export const DeletionNotice = ({ className }: DeletionNoticeProps) => {
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
                      failed: notice.failed.map(({ slot, message }) => ({
                          key: slot,
                          name: files[slot].name,
                          message,
                      })),
                  }
                : undefined,
        [files, notice],
    );

    // What Undo puts back: the files this move moved that are still in the Trash.
    const undoable = notice?.action === "trash" ? notice.done.filter((slot) => gone[slot] === "trash") : [];

    return (
        <SharedDeletionNotice
            {...(view && { notice: view })}
            undoCount={undoable.length}
            restoring={restoring}
            onUndo={() => restore(undoable).then(focusDismiss)}
            onDismiss={dismissNotice}
            {...(className && { className })}
        />
    );
};
