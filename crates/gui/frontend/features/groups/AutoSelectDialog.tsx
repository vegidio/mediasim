import { Trash2Icon } from "lucide-react";
import type { GroupFile } from "@/ipc/scan";
import { pickBest, preview } from "@/lib/marks";
import type { Rule } from "@/lib/rules";
import { applyLabel, willMark } from "./format";
import { RulesDialog } from "./RulesDialog";

type AutoSelectDialogProps = {
    open: boolean;
    /** The groups found, whose best files the rules pick. */
    groups: readonly { files: readonly GroupFile[] }[];
    /** Called with the rules as the dialog sets them, on Apply. */
    onApply: (rules: Rule[]) => void;
    /** Called on Cancel, Close, Escape or a click on the dimmed screen, with nothing to save. */
    onClose: () => void;
    /** Called once the dialog has closed, to put keyboard focus back; Radix's own return of focus is left out. */
    onClosed: () => void;
};

/** What Auto-select would mark with `rules`: how many files, and the space they free. */
const Preview = ({ groups, rules }: { groups: AutoSelectDialogProps["groups"]; rules: readonly Rule[] }) => {
    const { amount, freed } = willMark(preview(pickBest(groups, rules)));

    return (
        <div className="mx-6 mt-5 flex items-center gap-3 rounded-[10px] bg-muted px-4 py-3.5">
            <Trash2Icon aria-hidden="true" className="size-[18px] shrink-0 text-danger-bright" />
            <p className="text-sm">
                Will mark <strong className="font-semibold">{amount}</strong> grouped files
                <span className="text-muted-foreground">{freed}</span>
            </p>
        </div>
    );
};

/**
 * The Auto-select rules dialog (9b): the rule list, starting from the saved Auto-select rules each time it opens, and
 * what Auto-select would mark with the rules as set here. Apply hands them to the caller; anything else forgets them.
 */
export const AutoSelectDialog = ({ open, groups, onApply, onClose, onClosed }: AutoSelectDialogProps) => (
    <RulesDialog
        open={open}
        title="Auto-select"
        description="Keep one file per group. Everything else is marked for deletion — nothing is removed until you confirm."
        confirmLabel={applyLabel(groups.length)}
        onConfirm={onApply}
        onClose={onClose}
        onClosed={onClosed}
    >
        {(draft) => <Preview groups={groups} rules={draft} />}
    </RulesDialog>
);
