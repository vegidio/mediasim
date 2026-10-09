import { DeletionFooter } from "@/components/deletion/DeletionFooter";
import type { GroupFile } from "@/ipc/scan";
import { useScanStore } from "@/stores/scan";
import { GroupsDeletionDialog } from "./GroupsDeletionDialog";

type GroupsFooterProps = {
    /** The marked files still shown, in the groups' order and each group's order. */
    marked: readonly GroupFile[];
};

/** The deletion footer of the groups screen, for the marked files still shown. Disabled while a restore runs. */
export const GroupsFooter = ({ marked }: GroupsFooterProps) => {
    const anyGone = useScanStore((state) => state.gone.size > 0);
    const deletion = useScanStore((state) => state.deletion);
    const requestDeletion = useScanStore((state) => state.requestDeletion);

    return (
        <DeletionFooter
            marked={marked}
            anyGone={anyGone}
            emptyHint="Nothing marked yet. Tick files, or let Auto-select pick the extras for you."
            deletion={deletion}
            requestDeletion={requestDeletion}
            disabled={deletion.status === "restoring"}
            dialog={(button) => <GroupsDeletionDialog marked={marked}>{button}</GroupsDeletionDialog>}
            className="border-border bg-surface-sunken px-6"
            hintClassName="text-muted-foreground"
        />
    );
};
