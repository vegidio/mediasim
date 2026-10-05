import { FormatsFooter } from "@/features/start/FormatsFooter";
import { PairCard } from "@/features/start/PairCard";
import { SetCard } from "@/features/start/SetCard";

/** The start screen: pick a mode and supply its media. */
export const StartScreen = () => (
    // `m-auto` rather than centring from the parent, so content taller than the window scrolls instead of clipping at
    // the top.
    <div className="m-auto flex w-full max-w-[1080px] flex-col gap-8">
        <div className="flex flex-col gap-2">
            <h1 className="font-semibold text-[34px] tracking-[-0.025em]">What do you want to compare?</h1>
            <p className="text-[15px] text-muted-foreground">
                Pick a mode, then drop your media onto its drop area — or click it to browse.
            </p>
        </div>

        <div className="grid grid-cols-2 gap-5">
            <PairCard />
            <SetCard />
        </div>

        <FormatsFooter />
    </div>
);
