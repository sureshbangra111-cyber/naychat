import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5173-5175 are already used by other local projects on this machine.
    // strictPort: false lets Vite fall forward automatically if 5176 is taken too.
    port: 5176,
    strictPort: false,
    host: true,
    proxy: {
      // Proxy /api to the Express backend so the browser sees a single origin.
      // This keeps the httpOnly session cookies first-party in development, so
      // cookie behaviour matches production exactly.
      '/api': {
        // Must match the API server's PORT. Defaults to 4100 because 4000 is
        // commonly taken by other local Node apps.
        target: `http://localhost:${process.env.API_PORT ?? 4100}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});