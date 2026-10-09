import { RulesDialog } from "@/features/groups/RulesDialog";
import { useSettingsStore } from "@/stores/settings";

type DefaultRulesDialogProps = {
    open: boolean;
    /** Called on Save as default, once the rules are saved, and on Cancel, Close, Escape or a click on the dimmed screen. */
    onClose: () => void;
    /** Called once the dialog has closed, to put keyboard focus back; Radix's own return of focus is left out. */
    onClosed: () => void;
};

/**
 * The default rules dialog (10b): the rule list, starting from the saved Auto-select rules each time it opens. Save as
 * default saves them at once, as every other control on the Settings screen does; anything else forgets them.
 */
export const DefaultRulesDialog = ({ open, onClose, onClosed }: DefaultRulesDialogProps) => (
    <RulesDialog
        open={open}
        title="Default auto-select rules"
        description="Used whenever you click Auto-select. Rules applied from the Auto-select menu are saved here too."
        confirmLabel="Save as default"
        onConfirm={(rules) => {
            useSettingsStore.getState().update({ autoSelectRules: rules });
            onClose();
        }}
        onClose={onClose}
        onClosed={onClosed}
    />
);
