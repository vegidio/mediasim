import { useRef } from 'react';
import { useLazyThumbnail } from './useLazyThumbnail';
import { useScrollIntoView } from './useScrollIntoView';
import { Icon } from '@/components/atoms/Icon';
import { useCheckedStore, usePreviewStore, useSelectionStore } from '@/stores';
import { VIDEO_EXTENSIONS } from '@/utils/constants';
import { formatDate, formatFileSize } from '@/utils/format';

const getExtension = (filename: string): string => filename.slice(filename.lastIndexOf('.')).toLowerCase();

type ImageTileProps = {
    path: string;
    filename: string;
    status: 'idle' | 'loading' | 'loaded';
    modTime?: number;
    fileSize?: number;
};

export const ImageTile = ({ path, filename, status, modTime, fileSize }: ImageTileProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const isSelected = useSelectionStore((s) => s.selectedPath === path);
    const select = useSelectionStore((s) => s.select);
    const openPreview = usePreviewStore((s) => s.openPreview);
    const isChecked = useCheckedStore((s) => s.checkedPaths.has(path));
    const toggleChecked = useCheckedStore((s) => s.toggle);
    const isVideo = VIDEO_EXTENSIONS.has(getExtension(filename));

    useScrollIntoView(ref, isSelected);
    const thumbnail = useLazyThumbnail(ref, path, status);

    const metaLine = [
        modTime !== undefined ? formatDate(modTime) : undefined,
        thumbnail !== undefined ? `${thumbnail.width}x${thumbnail.height}` : undefined,
        fileSize !== undefined ? formatFileSize(fileSize) : undefined,
    ]
        .filter(Boolean)
        .join(' \u00b7 ');

    return (
        // biome-ignore lint/a11y/noStaticElementInteractions: desktop app with custom keyboard navigation
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav handled by useKeyboardNavigation hook
        <div
            ref={ref}
            className={`w-45 cursor-pointer rounded ${isSelected ? 'ring-3 ring-blue-500' : ''}`}
            onClick={() => select(path)}
            onDoubleClick={() => openPreview(path)}
        >
            <div className='relative w-45 h-45 bg-black/30 rounded-t overflow-hidden flex items-center justify-center'>
                {thumbnail?.dataUrl ? (
                    <img src={thumbnail.dataUrl} alt={filename} className='object-cover w-full h-full' />
                ) : (
                    <div className='w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin' />
                )}

                {thumbnail?.dataUrl && (
                    <div className='absolute bottom-1 right-1 bg-black/60 rounded p-0.5'>
                        {isVideo ? (
                            <Icon name='video' className='text-white' size={16} />
                        ) : (
                            <Icon name='image' className='text-white' size={16} />
                        )}
                    </div>
                )}

                <button
                    type='button'
                    className='absolute top-1 right-1 bg-black/60 rounded p-0.5 cursor-pointer'
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleChecked(path);
                    }}
                >
                    {isChecked ? (
                        <Icon name='checked' className='text-yellow-600' size={18} />
                    ) : (
                        <Icon name='unchecked' className='text-white/60' size={18} />
                    )}
                </button>
            </div>

            <div className={`${isChecked ? 'bg-yellow-600' : 'bg-white/5'} rounded-b px-2 py-1.5`}>
                <p className='text-xs text-gray-200 truncate' title={filename}>
                    {filename}
                </p>

                {metaLine && (
                    <p className={`text-[10px] ${isChecked ? 'text-yellow-900' : 'text-gray-400'} truncate`}>
                        {metaLine}
                    </p>
                )}
            </div>
        </div>
    );
};
