import { useEffect, useRef } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import './styles.css';

type VideoPlayerProps = {
    src: string;
    type?: string;
    width: number;
    height: number;
    onError?: () => void;
};

export const VideoPlayer = ({ src, type, width, height, onError }: VideoPlayerProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<ReturnType<typeof videojs>>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const videoEl = document.createElement('video');
        videoEl.classList.add('video-js');
        container.appendChild(videoEl);

        const player = videojs(videoEl, {
            controls: true,
            autoplay: true,
            loop: true,
            preload: 'auto',
            fluid: false,
            liveui: false,
            width,
            height,
            html5: {
                vhs: { overrideNative: false },
                nativeAudioTracks: true,
                nativeVideoTracks: true,
            },
            controlBar: {
                playbackRateMenuButton: false,
                pictureInPictureToggle: false,
                fullscreenToggle: false,
                liveDisplay: false,
                seekToLive: false,
                volumePanel: { inline: false },
                children: [
                    'playToggle',
                    'progressControl',
                    'customControlSpacer',
                    'currentTimeDisplay',
                    'timeDivider',
                    'durationDisplay',
                    'volumePanel',
                ],
            },
            sources: [type ? { src, type } : { src }],
        });

        player.on('error', () => onError?.());

        playerRef.current = player;

        return () => {
            if (playerRef.current) {
                playerRef.current.dispose();
                playerRef.current = null;
            }
        };
    }, [src, type, width, height, onError]);

    return <div ref={containerRef} />;
};
