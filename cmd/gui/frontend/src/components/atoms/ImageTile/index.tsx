import { useEffect, useRef } from 'react';
import { GetThumbnail } from '@bindings/gui/services/mediaservice.js';
import { MdImage, MdVideocam } from 'react-icons/md';
import { useImagesStore, useSelectionStore } from '@/stores';
import { formatDate, formatFileSize } from '@/utils/format';
import { toDataUrl } from '@/utils/image';
import { acquireSlot, releaseSlot } from '@/utils/throttle';
import { getCachedThumbnail } from '@/utils/thumbnailCache';

const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mp4', '.mkv', '.mov', '.webm', '.wmv']);
const GAP = 16;

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
    const setLoading = useImagesStore((s) => s.setLoading);
    const setThumbnailLoaded = useImagesStore((s) => s.setThumbnailLoaded);
    const isSelected = useSelectionStore((s) => s.selectedPath === path);
    const select = useSelectionStore((s) => s.select);
    const isVideo = VIDEO_EXTENSIONS.has(getExtension(filename));

    // Scroll into view when selected via keyboard navigation, with 16px padding
    useEffect(() => {
        if (!isSelected || !ref.current) return;

        const el = ref.current;
        let container = el.parentElement;
        while (container) {
            const overflow = getComputedStyle(container).overflowY;
            if (overflow === 'auto' || overflow === 'scroll') break;
            container = container.parentElement;
        }
        if (!container) return;

        const tileRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (tileRect.bottom > containerRect.bottom) {
            container.scrollBy({ top: tileRect.bottom - containerRect.bottom + GAP, behavior: 'smooth' });
        } else if (tileRect.top < containerRect.top) {
            container.scrollBy({ top: tileRect.top - containerRect.top - GAP, behavior: 'smooth' });
        }
    }, [isSelected]);

    const thumbnail = status === 'loaded' ? getCachedThumbnail(path) : undefined;

    useEffect(() => {
        if (!ref.current || status !== 'idle') return;

        // Make sure we fetch the thumbnail only when the element is visible
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    observer.disconnect();

                    // Throttle the number of concurrent thumbnail fetches
                    acquireSlot().then(() => {
                        setLoading(path);

                        GetThumbnail(path, 180)
                            .then(([data, w, h]) => setThumbnailLoaded(path, toDataUrl(data), w, h))
                            .finally(releaseSlot);
                    });
                }
            },
            { threshold: 0.1 },
        );

        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [path, status, setLoading, setThumbnailLoaded]);

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
                            <MdVideocam className='text-white' size={16} />
                        ) : (
                            <MdImage className='text-white' size={16} />
                        )}
                    </div>
                )}
            </div>

            <div className='bg-white/5 rounded-b px-2 py-1.5'>
                <p className='text-xs text-gray-200 truncate' title={filename}>
                    {filename}
                </p>

                {metaLine && <p className='text-[10px] text-gray-400 truncate'>{metaLine}</p>}
            </div>
        </div>
    );
};
