import { useEffect, useRef } from 'react';
import { GetThumbnail } from '@bindings/gui/services/mediaservice.js';
import { MdImage, MdVideocam } from 'react-icons/md';
import { useImagesStore } from '@/stores';
import { formatDate, formatFileSize } from '@/utils/format';
import { createBlobUrl } from '@/utils/image';

const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mp4', '.mkv', '.mov', '.webm', '.wmv']);

const getExtension = (filename: string): string => filename.slice(filename.lastIndexOf('.')).toLowerCase();

type ImageTileProps = {
    path: string;
    filename: string;
    blobUrl: string | undefined;
    loading: boolean;
    modTime: number | undefined;
    fileSize: number | undefined;
    width: number | undefined;
    height: number | undefined;
};

export const ImageTile = ({ path, filename, blobUrl, loading, modTime, fileSize, width, height }: ImageTileProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const setLoading = useImagesStore((s) => s.setLoading);
    const setThumbnail = useImagesStore((s) => s.setThumbnail);
    const isVideo = VIDEO_EXTENSIONS.has(getExtension(filename));

    useEffect(() => {
        if (!ref.current || blobUrl || loading) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    observer.disconnect();

                    setLoading(path);

                    GetThumbnail(path, 200).then(async ([data, w, h]) => {
                        const url = await createBlobUrl(data);
                        setThumbnail(path, url, w, h);
                    });
                }
            },
            { threshold: 0.1 },
        );

        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [path, blobUrl, loading, setLoading, setThumbnail]);

    const metaLine = [
        modTime !== undefined ? formatDate(modTime) : undefined,
        width !== undefined && height !== undefined ? `${width}x${height}` : undefined,
        fileSize !== undefined ? formatFileSize(fileSize) : undefined,
    ]
        .filter(Boolean)
        .join(' \u00b7 ');

    return (
        <div ref={ref} className='w-[180px]'>
            <div className='relative w-[180px] h-[180px] bg-black/30 rounded-t overflow-hidden flex items-center justify-center'>
                {blobUrl ? (
                    <img src={blobUrl} alt={filename} className='object-cover w-full h-full' />
                ) : (
                    <div className='w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin' />
                )}

                {blobUrl && (
                    <div className='absolute bottom-1 right-1 bg-black/60 rounded p-0.5'>
                        {isVideo ? (
                            <MdVideocam className='text-white' size={14} />
                        ) : (
                            <MdImage className='text-white' size={14} />
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
