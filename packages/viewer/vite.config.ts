import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:5317',
        changeOrigin: false,
      },
      '/ws': {
        target: 'ws://localhost:5317',
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
