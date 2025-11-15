import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const analyzerPath = fileURLToPath(new URL('./src/analyzer', import.meta.url));
const reactPlugin = react() as unknown as import('vite').PluginOption;

export default defineConfig({
  plugins: [reactPlugin],
  resolve: {
    alias: {
      '@analyzer': analyzerPath,
    },
  },
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
