import { Fragment } from "react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A step of the workflow. */
export type Step = "select" | "compare" | "review";

const STEPS: { id: Step; label: string }[] = [
    { id: "select", label: "Select" },
    { id: "compare", label: "Compare" },
    { id: "review", label: "Review" },
];

type StepIndicatorProps = {
    /** The step the user is on. */
    current: Step;
};

/**
 * The workflow's three steps, in order, with the current one marked and the ones before it shown done, with a check in
 * place of their number. Not interactive.
 */
export const StepIndicator = ({ current }: StepIndicatorProps) => {
    const currentIndex = STEPS.findIndex((step) => step.id === current);

    return (
        <nav aria-label="Progress">
            <ol className="flex items-center gap-1.5 text-[13px]">
                {STEPS.map((step, index) => {
                    const isCurrent = index === currentIndex;
                    const isDone = index < currentIndex;

                    return (
                        <Fragment key={step.id}>
                            {index > 0 && (
                                <li aria-hidden="true" className="flex">
                                    <ChevronRightIcon className="size-3.5 text-text-faint" />
                                </li>
                            )}
                            <li
                                aria-current={isCurrent ? "step" : undefined}
                                aria-label={isDone ? `${step.label}, done` : undefined}
                                className={cn(
                                    "flex items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5",
                                    isCurrent ? "bg-secondary text-foreground" : "text-muted-foreground",
                                )}
                            >
                                <span
                                    className={cn(
                                        "flex items-center justify-center rounded-full text-[11px]",
                                        isCurrent
                                            ? "size-5 bg-primary font-semibold text-primary-foreground"
                                            : isDone
                                              ? "size-[18px] border border-[#4D7C0F] text-primary"
                                              : "size-[18px] border border-border-strong",
                                    )}
                                >
                                    {isDone ? (
                                        <CheckIcon aria-hidden="true" strokeWidth={3} className="size-2.5" />
                                    ) : (
                                        index + 1
                                    )}
                                </span>
                                {step.label}
                            </li>
                        </Fragment>
                    );
                })}
            </ol>
        </nav>
    );
};
