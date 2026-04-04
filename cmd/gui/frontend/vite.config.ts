import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import wails from '@wailsio/runtime/plugins/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), wails('./bindings'), tailwindcss()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@bindings': path.resolve(__dirname, './bindings'),
        },
    },
});
