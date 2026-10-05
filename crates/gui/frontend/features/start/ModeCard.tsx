import { type ReactNode, type Ref, useId } from "react";

/** The dashed look of an empty drop target, in either card. Disabled targets keep it at reduced emphasis. */
export const dropTargetClassName =
    "flex flex-col items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-border-strong bg-surface-sunken text-[13px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-[22px]";

type ModeCardProps = {
    /** The card's box, for a card that is a drop target as a whole. */
    ref?: Ref<HTMLElement>;
    icon: ReactNode;
    title: string;
    description: string;
    children: ReactNode;
};

/** One of the start screen's mode cards: its icon, title and description, then the mode's own controls. */
export const ModeCard = ({ ref, icon, title, description, children }: ModeCardProps) => {
    const titleId = useId();

    return (
        <section
            ref={ref}
            aria-labelledby={titleId}
            className="flex flex-col gap-[22px] rounded-[14px] border border-border bg-card p-7"
        >
            <div className="flex items-start gap-3.5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-secondary text-primary [&_svg]:size-5">
                    {icon}
                </div>
                <div className="flex flex-col gap-1">
                    <h2 id={titleId} className="font-semibold text-lg tracking-[-0.01em]">
                        {title}
                    </h2>
                    <p className="text-muted-foreground text-sm leading-normal">{description}</p>
                </div>
            </div>
            {children}
        </section>
    );
};
