import { AppBar, Button, Toolbar } from '@mui/material';
import { DeleteFiles } from '@bindings/gui/services/mediaservice';
import { Dialogs } from '@wailsio/runtime';
import type { TailwindProps } from '@/types/TailwindProps';
import { Icon, ToolbarButton } from '@/components/atoms';
import { TileSlider } from '@/components/molecules';
import { useCheckedStore, useComparisonStore, useSelectionStore } from '@/stores';

type BottomBarProps = TailwindProps & {
    onClose?: () => void;
    onCompare?: () => void;
};

export const BottomBar = ({ onClose, onCompare }: BottomBarProps) => {
    const groups = useComparisonStore((s) => s.groups);
    const removeFiles = useComparisonStore((s) => s.removeFiles);
    const autoMark = useCheckedStore((s) => s.autoMark);
    const checkedPaths = useCheckedStore((s) => s.checkedPaths);
    const clearChecked = useCheckedStore((s) => s.clear);
    const toggle = useCheckedStore((s) => s.toggle);
    const selectedPath = useSelectionStore((s) => s.selectedPath);
    const isMarked = selectedPath !== undefined && checkedPaths.has(selectedPath);

    const handleDelete = async () => {
        const result = await Dialogs.Warning({
            Title: 'Delete Marked',
            Message: `Are you sure that you want to delete ${checkedPaths.size} files? This process is irreversible.`,
            Buttons: [
                { Label: 'Continue', IsDefault: true },
                { Label: 'Cancel', IsCancel: true },
            ],
        });

        if (result !== 'Continue') return;

        const paths = [...checkedPaths];
        await DeleteFiles(paths);
        removeFiles(checkedPaths);
        clearChecked();
    };

    return (
        <AppBar position='static' component='footer'>
            <Toolbar variant='dense' className='flex'>
                {groups ? (
                    <>
                        <div className='flex flex-1 items-center gap-2'>
                            <ToolbarButton
                                icon={<Icon name='auto-mark' size={22} />}
                                label='Auto Mark'
                                onClick={() => groups && autoMark(groups)}
                            />

                            <ToolbarButton
                                icon={<Icon name={isMarked ? 'unmark' : 'mark'} size={22} />}
                                label={isMarked ? 'Unmark' : 'Mark'}
                                disabled={selectedPath === undefined}
                                onClick={() => selectedPath && toggle(selectedPath)}
                                className='min-w-14'
                            />

                            <ToolbarButton
                                icon={<Icon name='delete' size={22} />}
                                label='Delete Marked'
                                disabled={checkedPaths.size === 0}
                                onClick={handleDelete}
                            />
                        </div>

                        <div className='flex flex-1' />
                    </>
                ) : (
                    <>
                        <div className='flex flex-1 justify-start'>
                            <ToolbarButton icon={<Icon name='close' size={22} />} label='Close' onClick={onClose} />
                        </div>

                        <div className='flex flex-1 justify-center'>
                            <Button
                                color='inherit'
                                size='small'
                                startIcon={<Icon name='compare' />}
                                onClick={onCompare}
                                className='normal-case'
                            >
                                Compare
                            </Button>
                        </div>
                    </>
                )}

                <div className='flex flex-1 justify-end'>
                    <TileSlider />
                </div>
            </Toolbar>
        </AppBar>
    );
};
