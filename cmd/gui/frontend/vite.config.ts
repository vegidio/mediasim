import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import wails from '@wailsio/runtime/plugins/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        target: 'esnext',
    },
    plugins: [
        react({
            babel: {
                plugins: ['babel-plugin-react-compiler'],
            },
        }),
        wails('./bindings'),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@bindings': path.resolve(__dirname, './bindings'),
        },
    },
});
