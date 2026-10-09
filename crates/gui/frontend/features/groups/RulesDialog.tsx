import { type ReactNode, useRef, useState } from "react";
import { SparklesIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Rule } from "@/lib/rules";
import { useSettingsStore } from "@/stores/settings";
import { RuleList } from "./RuleList";

type RulesDialogProps = {
    open: boolean;
    /** The heading beside the sparkles icon. */
    title: string;
    /** The line under the title. */
    description: string;
    /** The lime button's text. */
    confirmLabel: string;
    /** Called with the rules as the dialog sets them, on the lime button. */
    onConfirm: (rules: Rule[]) => void;
    /** Called on Cancel, Close, Escape or a click on the dimmed screen, with nothing to save. */
    onClose: () => void;
    /** Called once the dialog has closed, to put keyboard focus back; Radix's own return of focus is left out. */
    onClosed: () => void;
    /** What goes between the rule list and the buttons, given the rules as the dialog sets them. */
    children?: (draft: readonly Rule[]) => ReactNode;
};

/**
 * The dialog 9b and 10b share: the sparkles header, the rule list, starting from the saved Auto-select rules each time
 * it opens, Cancel and a lime button that hands the rules to the caller. Anything else forgets them.
 */
export const RulesDialog = ({
    open,
    title,
    description,
    confirmLabel,
    onConfirm,
    onClose,
    onClosed,
    children,
}: RulesDialogProps) => {
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
                className="flex w-[600px] flex-col rounded-2xl border border-border bg-surface-inset text-foreground shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
            >
                <div className="flex items-start gap-3.5 px-6 pt-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(190,242,100,0.12)] text-primary">
                        <SparklesIcon aria-hidden="true" className="size-5" />
                    </span>
                    <div className="flex grow flex-col gap-1">
                        <DialogTitle className="font-semibold text-lg tracking-[-0.01em]">{title}</DialogTitle>
                        <DialogDescription className="text-muted-foreground text-sm leading-normal">
                            {description}
                        </DialogDescription>
                    </div>
                    <DialogClose
                        aria-label="Close"
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
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

                {children?.(draft)}

                <div className="flex justify-end gap-2.5 px-6 pt-5 pb-6">
                    <DialogClose asChild>
                        <Button
                            variant="outline"
                            className="h-10 rounded-lg border-border-strong bg-transparent px-4 font-medium text-foreground text-sm dark:border-border-strong dark:bg-transparent"
                        >
                            Cancel
                        </Button>
                    </DialogClose>
                    <Button
                        onClick={() => onConfirm([...draft])}
                        className="h-10 whitespace-nowrap rounded-lg px-[18px] font-semibold text-primary-foreground text-sm hover:bg-primary/90"
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
