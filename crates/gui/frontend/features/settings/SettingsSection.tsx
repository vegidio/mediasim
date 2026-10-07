import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

type SettingsSectionProps = {
    /** The small upper-case heading over the panel. */
    title: string;
    /** The section's rows. */
    children: ReactNode;
};

/** A group of settings: a heading over a rounded panel holding one row per setting, divided by a thin line. */
export const SettingsSection = ({ title, children }: SettingsSectionProps) => {
    const id = useId();

    return (
        <section aria-labelledby={id} className="flex flex-col gap-2">
            <h2 id={id} className="font-semibold text-[#A1A1AA] text-[11px] uppercase tracking-[0.06em]">
                {title}
            </h2>
            <div className="overflow-hidden rounded-xl border border-[#27272A] bg-[#111113] [&>*+*]:border-[#1F1F23] [&>*+*]:border-t">
                {children}
            </div>
        </section>
    );
};

type SettingRowProps = {
    /** The setting's name. */
    name: string;
    /** The one-line explanation under the name. */
    hint: string;
    /** The ids the name and hint take, for the control to be labelled and described by. */
    nameId?: string;
    hintId?: string;
    /** The control that changes the setting. */
    control: ReactNode;
    /** Whether the control comes before the name, as a radio option's indicator does, rather than at the row's end. */
    leading?: boolean;
    /**
     * The row's element. A `label` (the default) makes a press anywhere on the row activate the control, which suits a
     * switch or a radio; a `div` suits a control such as a slider, which a press on the row's text shouldn't move.
     */
    as?: "label" | "div";
    className?: string;
};

/**
 * One setting: its name with its explanation, and its control. Unless rendered `as="div"`, the whole row is a label,
 * so pressing anywhere on it activates the control.
 */
export const SettingRow = ({
    name,
    hint,
    nameId,
    hintId,
    control,
    leading = false,
    as: Row = "label",
    className,
}: SettingRowProps) => (
    <Row
        className={cn(
            "flex items-center px-[18px] py-3.5",
            Row === "label" && "cursor-pointer",
            leading ? "gap-3.5" : "justify-between gap-6",
            className,
        )}
    >
        {leading && control}
        <span className="flex min-w-0 flex-col gap-0.5">
            <span id={nameId} className="font-medium text-sm">
                {name}
            </span>
            <span id={hintId} className="text-[#A1A1AA] text-xs">
                {hint}
            </span>
        </span>
        {!leading && control}
    </Row>
);
