import { useRef, useState } from "react";
import { SparklesIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { GroupFile } from "@/ipc/scan";
import { useSettingsStore } from "@/stores/settings";
import { applyLabel, willMark } from "./format";
import { pickBest, preview } from "./marks";
import { RuleList } from "./RuleList";
import type { Rule } from "./rules";

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

/**
 * The Auto-select rules dialog (9b): the rule list, starting from the saved Auto-select rules each time it opens, and
 * what Auto-select would mark with the rules as set here. Apply hands them to the caller; anything else forgets them.
 */
export const AutoSelectDialog = ({ open, groups, onApply, onClose, onClosed }: AutoSelectDialogProps) => {
    const saved = useSettingsStore((state) => state.autoSelectRules);
    const [draft, setDraft] = useState<readonly Rule[]>(saved);
    // Seeds the draft from the saved rules on each opening, so a change left by Cancel is gone next time.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setDraft(saved);
    }
    // Whether a row is lifted from the keyboard, when Escape puts it back rather than closing the dialog.
    const dragging = useRef(false);

    const { amount, freed } = willMark(preview(pickBest(groups, draft)));

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent
                onEscapeKeyDown={(event) => {
                    if (dragging.current) event.preventDefault();
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    onClosed();
                }}
                className="flex w-[600px] flex-col rounded-2xl border border-[#27272A] bg-[#0F0F11] text-[#FAFAFA] shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
            >
                <div className="flex items-start gap-3.5 px-6 pt-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(190,242,100,0.12)] text-[#BEF264]">
                        <SparklesIcon aria-hidden="true" className="size-5" />
                    </span>
                    <div className="flex grow flex-col gap-1">
                        <DialogTitle className="font-semibold text-lg tracking-[-0.01em]">Auto-select</DialogTitle>
                        <DialogDescription className="text-[#A1A1AA] text-sm leading-normal">
                            Keep one file per group. Everything else is marked for deletion — nothing is removed until
                            you confirm.
                        </DialogDescription>
                    </div>
                    <DialogClose
                        aria-label="Close"
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#A1A1AA] outline-none hover:bg-[#18181B] focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <XIcon aria-hidden="true" className="size-4" />
                    </DialogClose>
                </div>

                <div className="px-6 pt-5">
                    <RuleList
                        rules={draft}
                        onChange={setDraft}
                        onDraggingChange={(lifted) => {
                            dragging.current = lifted;
                        }}
                    />
                </div>

                <div className="mx-6 mt-5 flex items-center gap-3 rounded-[10px] bg-[#18181B] px-4 py-3.5">
                    <Trash2Icon aria-hidden="true" className="size-[18px] shrink-0 text-[#F87171]" />
                    <p className="text-sm">
                        Will mark <strong className="font-semibold">{amount}</strong> grouped files
                        <span className="text-[#A1A1AA]">{freed}</span>
                    </p>
                </div>

                <div className="flex justify-end gap-2.5 px-6 pt-5 pb-6">
                    <DialogClose asChild>
                        <Button
                            variant="outline"
                            className="h-10 rounded-lg border-[#3F3F46] bg-transparent px-4 font-medium text-[#FAFAFA] text-sm dark:border-[#3F3F46] dark:bg-transparent"
                        >
                            Cancel
                        </Button>
                    </DialogClose>
                    <Button
                        onClick={() => onApply([...draft])}
                        className="h-10 whitespace-nowrap rounded-lg px-[18px] font-semibold text-[#1A2E05] text-sm hover:bg-[#BEF264]/90"
                    >
                        {applyLabel(groups.length)}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
