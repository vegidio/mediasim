import {
    Box,
    Button,
    Dialog,
    DialogContent,
    Divider,
    List,
    ListItemButton,
    ListItemText,
    Typography,
} from '@mui/material';
import { Application, Dialogs } from '@wailsio/runtime';
import { Icon } from '@/components/atoms';
import { ModalTitle } from '@/components/molecules';
import { useAppStore } from '@/stores';

type WelcomeDialogProps = {
    open: boolean;
    onDirectorySelected: (path: string) => void;
};

export const WelcomeDialog = ({ open, onDirectorySelected }: WelcomeDialogProps) => {
    const recentDirectories = useAppStore((s) => s.recentDirectories);
    const selectDirectory = useAppStore((s) => s.selectDirectory);

    const handlePickDirectory = async () => {
        const selected = await Dialogs.OpenFile({
            CanChooseDirectories: true,
            CanChooseFiles: false,
        });

        if (selected.length > 0) {
            selectDirectory(selected);
            onDirectorySelected(selected);
        }
    };

    const handleRecentClick = (path: string) => {
        selectDirectory(path);
        onDirectorySelected(path);
    };

    const handleQuit = () => {
        Application.Quit();
    };

    return (
        <Dialog
            open={open}
            maxWidth='sm'
            fullWidth
            disableEscapeKeyDown
            slotProps={{
                backdrop: { className: 'bg-black/80' },
            }}
            onClose={(_event, reason) => {
                if (reason === 'backdropClick') return;
            }}
        >
            <ModalTitle title='Welcome' onClose={handleQuit} />

            <DialogContent className='flex p-0 min-h-87.5'>
                {/* Left side: icon + app name */}
                <Box className='flex flex-col items-center justify-center w-48 shrink-0 bg-[#1a1a1a] p-6'>
                    <Icon name='logo' size={64} className='text-blue-400 mb-3' />
                    <Typography variant='h6' fontWeight={700}>
                        MediaSim
                    </Typography>
                </Box>

                <Divider orientation='vertical' flexItem />

                {/* Right side: recents + button */}
                <Box className='flex flex-col flex-1 min-w-0'>
                    {/* Recent directories list */}
                    <Box className='flex-1 overflow-auto p-2'>
                        {recentDirectories.length === 0 ? (
                            <Box className='flex items-center justify-center h-full'>
                                <Typography variant='body2' color='text.secondary'>
                                    No recent directories
                                </Typography>
                            </Box>
                        ) : (
                            <List dense disablePadding>
                                {recentDirectories.map((dir) => (
                                    <ListItemButton key={dir.path} onClick={() => handleRecentClick(dir.path)}>
                                        <ListItemText
                                            primary={
                                                <Typography variant='body2' fontWeight={700} noWrap>
                                                    {dir.name}
                                                </Typography>
                                            }
                                            secondary={
                                                <Typography variant='caption' color='text.secondary' noWrap>
                                                    {dir.path}
                                                </Typography>
                                            }
                                        />
                                    </ListItemButton>
                                ))}
                            </List>
                        )}
                    </Box>

                    <Divider />

                    {/* Open directory button */}
                    <Box className='p-3'>
                        <Button variant='contained' fullWidth onClick={handlePickDirectory}>
                            Open Directory...
                        </Button>
                    </Box>
                </Box>
            </DialogContent>
        </Dialog>
    );
};
