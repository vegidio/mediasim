import { Button, Dialog, DialogActions, DialogContent } from '@mui/material';
import { ExtraComparisonsSection } from './ExtraComparisonsSection';
import { MediaTypeSection } from './MediaTypeSection';
import { ThresholdSection } from './ThresholdSection';
import { ModalTitle } from '@/components/molecules';

type CompareDialogProps = {
    open: boolean;
    onClose?: () => void;
    onStart?: () => void;
};

export const CompareDialog = ({ open, onClose, onStart }: CompareDialogProps) => {
    return (
        <Dialog
            open={open}
            maxWidth='sm'
            fullWidth
            onClose={(_event, reason) => {
                if (reason === 'backdropClick') return;
                onClose?.();
            }}
        >
            <ModalTitle title='Settings' onClose={onClose} />

            <DialogContent className='flex flex-col gap-5 pt-2!'>
                <MediaTypeSection />
                <ExtraComparisonsSection />
                <ThresholdSection />
            </DialogContent>

            <DialogActions className='px-6 pb-4'>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant='contained' onClick={() => onStart?.()}>
                    Start
                </Button>
            </DialogActions>
        </Dialog>
    );
};
