import { useShallow } from "zustand/react/shallow";
import { DeletionFooter } from "@/components/deletion/DeletionFooter";
import { selectMarkedFiles, usePairResultStore } from "@/stores/pairResult";
import { ConfirmDeletionDialog } from "./ConfirmDeletionDialog";

/** The deletion footer of the pair result screen, for the pair's marked files. */
export const PairDeletionFooter = () => {
    const chosen = usePairResultStore(useShallow(selectMarkedFiles));
    const anyGone = usePairResultStore((state) => Boolean(state.gone.a || state.gone.b));
    const deletion = usePairResultStore((state) => state.deletion);
    const requestDeletion = usePairResultStore((state) => state.requestDeletion);

    return (
        <DeletionFooter
            marked={chosen}
            anyGone={anyGone}
            emptyHint="Nothing marked yet. Mark the file you don't need."
            deletion={deletion}
            requestDeletion={requestDeletion}
            dialog={(button) => <ConfirmDeletionDialog>{button}</ConfirmDeletionDialog>}
            className="border-border bg-surface-sunken px-10"
        />
    );
};
