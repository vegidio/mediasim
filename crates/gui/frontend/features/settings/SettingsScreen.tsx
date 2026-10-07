import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { focusSettings } from "@/features/shell/Header";
import { useScreenStore } from "@/stores/screen";
import { useSettingsStore } from "@/stores/settings";
import { ComparisonSection } from "./ComparisonSection";
import { DeletingFilesSection } from "./DeletingFilesSection";

/**
 * The Settings screen: Back to the screen it was opened from, Reset to defaults, and each section of settings. Every
 * change is in force as soon as it is made; there is no Save.
 */
export const SettingsScreen = () => {
    const closeSettings = useScreenStore((state) => state.closeSettings);
    const reset = useSettingsStore((state) => state.reset);

    return (
        // Pulled up from main's 40 px padding to 10a's 28 px.
        <div className="mx-auto -my-3 flex w-full max-w-[760px] flex-col gap-5">
            <div className="flex items-center gap-4">
                <Button
                    variant="outline"
                    onClick={() => {
                        closeSettings();
                        focusSettings();
                    }}
                    className="h-9 gap-1.5 rounded-lg border-[#27272A] bg-[#09090B] pr-3 pl-2 text-[#E4E4E7] text-sm dark:border-[#27272A] dark:bg-[#09090B] [&_svg:not([class*='size-'])]:size-4"
                >
                    <ArrowLeftIcon aria-hidden="true" />
                    Back
                </Button>
                <h1 className="flex-1 font-semibold text-2xl tracking-[-0.02em]">Settings</h1>
                <Button
                    variant="outline"
                    onClick={reset}
                    className="h-9 rounded-lg border-[#27272A] bg-[#09090B] px-3 text-[#A1A1AA] text-[13px] dark:border-[#27272A] dark:bg-[#09090B]"
                >
                    Reset to defaults
                </Button>
            </div>

            <ComparisonSection />
            <DeletingFilesSection />
        </div>
    );
};
