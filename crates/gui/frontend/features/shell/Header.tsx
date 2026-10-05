import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Step, StepIndicator } from "@/features/shell/StepIndicator";
import { isMacOs } from "@/ipc/os";

type HeaderProps =
    | {
          /** The workflow step the step indicator marks as current. */
          current: Step;
      }
    | {
          /** The text shown in the step indicator's place, on a screen outside the workflow's steps. */
          title: string;
      };

/** The MediaSim logo: two overlapping rounded squares. */
const Logo = () => (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0 stroke-primary">
        <rect x="3" y="3" width="12" height="12" rx="3" strokeWidth="2" />
        <rect x="9" y="9" width="12" height="12" rx="3" strokeWidth="2" className="fill-primary/18" />
    </svg>
);

/** The strip across the top of the window, which is also its title bar on every platform. */
export const Header = (props: HeaderProps) => (
    <header
        // Dragging the header moves the window and double-clicking it toggles maximize. `deep` makes the whole subtree a
        // drag region; buttons inside it still take their own presses, because Tauri skips clickable elements.
        data-tauri-drag-region="deep"
        // `select-none`: on macOS, Tauri leaves a double-click unprevented, which would select header text as it zooms.
        className="flex h-14 shrink-0 select-none items-center gap-7 border-b border-border bg-surface-sunken px-5"
    >
        <div className="flex w-[290px] items-center gap-2.5">
            {/* On macOS the native traffic lights are drawn over this space; Windows and Linux keep their title bar. */}
            {isMacOs() && <span data-testid="traffic-light-inset" aria-hidden="true" className="w-[70px] shrink-0" />}
            <Logo />
            <span className="font-semibold text-[15px] tracking-[-0.01em]">MediaSim</span>
        </div>

        <div className="flex flex-1 justify-center">
            {"title" in props ? (
                <span className="text-[13px] text-muted-foreground">{props.title}</span>
            ) : (
                <StepIndicator current={props.current} />
            )}
        </div>

        <div className="flex w-[290px] justify-end">
            {/* Disabled until the Settings screen exists. */}
            <Button variant="outline" size="icon-lg" aria-label="Settings" disabled>
                <SlidersHorizontalIcon />
            </Button>
        </div>
    </header>
);
