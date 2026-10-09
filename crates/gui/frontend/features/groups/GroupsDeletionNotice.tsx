import { useMemo } from "react";
import { DeletionNotice, focusDismiss, type NoticeView } from "@/components/deletion/DeletionNotice";
import { undoable as undoableOf } from "@/lib/deletion";
import { selectMedia, useScanStore } from "@/stores/scan";

type GroupsDeletionNoticeProps = {
    className?: string;
};

/**
 * The deletion notice for the groups screen's last move, deletion or restore. Undo puts back the files that move moved
 * that are still in the Trash, marked.
 */
export const GroupsDeletionNotice = ({ className }: GroupsDeletionNoticeProps) => {
    const media = useScanStore(selectMedia);
    const notice = useScanStore((state) => state.notice);
    const dismissNotice = useScanStore((state) => state.dismissNotice);
    const gone = useScanStore((state) => state.gone);
    const restoring = useScanStore((state) => state.deletion.status === "restoring");
    const restore = useScanStore((state) => state.restore);

    // Built once per notice: a new view restarts the notice's timer and drops its hover and focus hold. `media` changes
    // only on a restore, which sets a new notice anyway.
    const view = useMemo((): NoticeView | undefined => {
        if (!notice) return;

        return {
            action: notice.action,
            done: notice.done.map((path) => ({ size: media.get(path)?.size ?? 0 })),
            failed: notice.failed.map(({ key, message }) => ({ key, name: media.get(key)?.name ?? key, message })),
        };
    }, [media, notice]);

    const undoable = undoableOf(notice, (path) => gone.get(path) === "trash");

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
