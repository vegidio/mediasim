import { AppBar, Button, Toolbar } from '@mui/material';
import { DeleteFiles } from '@bindings/gui/services/mediaservice';
import { Dialogs } from '@wailsio/runtime';
import type { TailwindProps } from '@/types/TailwindProps';
import { Icon, ToolbarButton } from '@/components/atoms';
import { TileSlider } from '@/components/molecules';
import { useCheckedStore, useComparisonStore, useSelectionStore } from '@/stores';

const DELETE_BATCH_SIZE = 200;

type BottomBarProps = TailwindProps & {
    onClose?: () => void;
    onCompare?: () => void;
};

export const BottomBar = ({ onClose, onCompare }: BottomBarProps) => {
    const groups = useComparisonStore((s) => s.groups);
    const removeFiles = useComparisonStore((s) => s.removeFiles);
    const autoMark = useCheckedStore((s) => s.autoMark);
    const checkedPaths = useCheckedStore((s) => s.checkedPaths);
    const uncheck = useCheckedStore((s) => s.uncheck);
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
        const deleted: string[] = [];
        let error: unknown;

        // Delete in batches to keep each runtime request small; large bodies are chunked by the JS runtime, which the
        // Go side doesn't support.
        try {
            for (let i = 0; i < paths.length; i += DELETE_BATCH_SIZE) {
                deleted.push(...(await DeleteFiles(paths.slice(i, i + DELETE_BATCH_SIZE))));
            }
        } catch (e) {
            error = e;
        }

        const deletedSet = new Set(deleted);
        removeFiles(deletedSet);
        uncheck(deletedSet);

        if (error) {
            await Dialogs.Error({
                Title: 'Delete Marked',
                Message: `An error occurred while deleting files: ${error instanceof Error ? error.message : String(error)}`,
            });
        } else if (deleted.length < paths.length) {
            await Dialogs.Warning({
                Title: 'Delete Marked',
                Message: `${paths.length - deleted.length} of ${paths.length} files could not be deleted.`,
            });
        }
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
                                sx={{ color: 'text.secondary' }}
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
