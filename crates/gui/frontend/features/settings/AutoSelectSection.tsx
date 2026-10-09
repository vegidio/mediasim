import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { rankedRules } from "@/features/groups/rules";
import { useSettingsStore } from "@/stores/settings";
import { DefaultRulesDialog } from "./DefaultRulesDialog";
import { SettingsSection } from "./SettingsSection";

/**
 * The "Auto-select" section (10a): the saved rules that are on, in order, as numbered chips under "Default rules", and
 * "Edit rules", which opens the default rules dialog (10b).
 */
export const AutoSelectSection = () => {
    const saved = useSettingsStore((state) => state.autoSelectRules);
    const rules = useMemo(() => rankedRules(saved), [saved]);
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
                                    <span className="flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md border border-[#27272A] bg-[#18181B] px-2 text-[#E4E4E7]">
                                        <span className="font-mono text-[#A1A1AA]">{rank}</span>
                                        {/* Dropped by the flex layout, but read between the rank and the label. */}{" "}
                                        <span>{label}</span>
                                    </span>
                                    {index < rules.length - 1 && (
                                        <span aria-hidden="true" className="text-[#52525B]">
                                            ›
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <span className="text-[#A1A1AA] text-xs">All rules are off</span>
                    )}
                </div>
                <Button
                    ref={edit}
                    variant="outline"
                    onClick={() => setOpen(true)}
                    className="h-[34px] shrink-0 whitespace-nowrap rounded-lg border-[#3F3F46] bg-transparent px-3 font-medium text-[#FAFAFA] text-[13px] dark:border-[#3F3F46] dark:bg-transparent"
                >
                    Edit rules
                </Button>
            </div>
            <DefaultRulesDialog open={open} onClose={() => setOpen(false)} onClosed={() => edit.current?.focus()} />
        </SettingsSection>
    );
};
