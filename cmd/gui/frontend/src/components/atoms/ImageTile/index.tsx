import { type RefObject, useRef } from 'react';
import { useLazyThumbnail } from './useLazyThumbnail';
import { useScrollIntoView } from './useScrollIntoView';
import { Icon } from '@/components/atoms/Icon';
import { Spinner } from '@/components/atoms/Spinner';
import { useCheckedStore, usePreviewStore, useSelectionStore } from '@/stores';
import { VIDEO_EXTENSIONS } from '@/utils/constants';
import { formatDate, formatFileSize } from '@/utils/format';
import { getExtension } from '@/utils/path';

type ImageTileProps = {
    path: string;
    filename: string;
    status: 'idle' | 'loading' | 'loaded';
    size: number;
    modTime?: number;
    fileSize?: number;
    scrollRef?: RefObject<HTMLDivElement | null>;
};

export const ImageTile = ({ path, filename, status, size, modTime, fileSize, scrollRef }: ImageTileProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const isSelected = useSelectionStore((s) => s.selectedPath === path);
    const select = useSelectionStore((s) => s.select);
    const openPreview = usePreviewStore((s) => s.openPreview);
    const isChecked = useCheckedStore((s) => s.checkedPaths.has(path));
    const toggleChecked = useCheckedStore((s) => s.toggle);
    const isVideo = VIDEO_EXTENSIONS.has(getExtension(filename));

    useScrollIntoView(ref, isSelected);
    const thumbnail = useLazyThumbnail(ref, path, status, scrollRef);

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
            style={{ width: size }}
            className={`cursor-pointer rounded ${isSelected ? 'ring-3 ring-blue-500' : ''}`}
            onClick={() => select(path)}
            onDoubleClick={() => openPreview(path)}
        >
            <div
                style={{ width: size, height: size }}
                className='relative bg-black/30 rounded-t overflow-hidden flex items-center justify-center'
            >
                {thumbnail?.url ? (
                    <img src={thumbnail.url} alt={filename} className='object-cover w-full h-full' />
                ) : (
                    <Spinner />
                )}

                {thumbnail?.url && (
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
