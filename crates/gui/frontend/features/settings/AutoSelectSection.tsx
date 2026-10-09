import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { rankedRules } from "@/lib/rules";
import { useSettingsStore } from "@/stores/settings";
import { DefaultRulesDialog } from "./DefaultRulesDialog";
import { SettingsSection } from "./SettingsSection";

/**
 * The "Auto-select" section (10a): the saved rules that are on, in order, as numbered chips under "Default rules", and
 * "Edit rules", which opens the default rules dialog (10b).
 */
export const AutoSelectSection = () => {
    const saved = useSettingsStore((state) => state.autoSelectRules);
    const rules = rankedRules(saved);
    const [open, setOpen] = useState(false);
    const edit = useRef<HTMLButtonElement>(null);

    return (
        <SettingsSection title="Auto-select">
            {/* A `div`, not `SettingRow`'s label: a press on a chip shouldn't open the dialog. */}
            <div className="flex items-center gap-6 px-[18px] py-3.5">
                <div className="flex min-w-0 grow flex-col gap-1.5">
                    <span className="font-medium text-sm">Default rules</span>
                    {rules.length > 0 ? (
                        <ol aria-label="Default rules" className="flex flex-wrap items-center gap-1.5 text-xs">
                            {rules.map(({ id, rank, label }, index) => (
                                <li key={id} className="flex items-center gap-1.5">
                                    <span className="flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-muted px-2 text-text-label">
                                        <span className="font-mono text-muted-foreground">{rank}</span>
                                        {/* Dropped by the flex layout, but read between the rank and the label. */}{" "}
                                        <span>{label}</span>
                                    </span>
                                    {index < rules.length - 1 && (
                                        <span aria-hidden="true" className="text-text-faint">
                                            ›
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <span className="text-muted-foreground text-xs">All rules are off</span>
                    )}
                </div>
                <Button
                    ref={edit}
                    variant="outline"
                    onClick={() => setOpen(true)}
                    className="h-[34px] shrink-0 whitespace-nowrap rounded-lg border-border-strong bg-transparent px-3 font-medium text-foreground text-[13px] dark:border-border-strong dark:bg-transparent"
                >
                    Edit rules
                </Button>
            </div>
            <DefaultRulesDialog open={open} onClose={() => setOpen(false)} onClosed={() => edit.current?.focus()} />
        </SettingsSection>
    );
};
