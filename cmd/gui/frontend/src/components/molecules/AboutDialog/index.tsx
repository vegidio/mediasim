import { Dialog, Divider, Link, Typography } from '@mui/material';
import { Browser } from '@wailsio/runtime';
import { Icon } from '@/components/atoms';
import { ModalTitle } from '@/components/molecules/ModalTitle';
import { VERSION } from '@/utils/constants';

type AboutDialogProps = {
    open: boolean;
    onClose: () => void;
};

export const AboutDialog = ({ open, onClose }: AboutDialogProps) => {
    return (
        <Dialog open={open} onClose={onClose} slotProps={{ paper: { className: 'w-96' } }}>
            <ModalTitle title='About' onClose={onClose} />

            <div className='flex flex-col p-6 pt-2.5 gap-4 items-center'>
                <Icon name='logo' size={144} className='text-blue-400' />

                <div className='flex flex-col gap-1 items-center'>
                    <Typography variant='h5' className='font-bold'>
                        MediaSim
                    </Typography>
                    <Typography variant='body2' className='text-[#b0b0b0]'>
                        Version {VERSION}
                    </Typography>
                </div>

                <div className='flex flex-col mt-2 gap-1 items-center text-[#b0b0b0]'>
                    <Typography className='text-sm'>© 2025–2026, Vinicius Egidio</Typography>

                    <div className='flex flex-row gap-2'>
                        <Link
                            href='#'
                            className='text-sm'
                            onClick={() => Browser.OpenURL('https://github.com/vegidio/mediasim')}
                        >
                            GitHub
                        </Link>

                        <Divider orientation='vertical' flexItem className='bg-[#b0b0b0] my-0.5' />

                        <Link href='#' className='text-sm' onClick={() => Browser.OpenURL('https://vinicius.io')}>
                            vinicius.io
                        </Link>
                    </div>
                </div>
            </div>
        </Dialog>
    );
};
