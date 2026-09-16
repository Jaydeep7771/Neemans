import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Honour an assigned PORT so the dev server can move off 5173 when it is taken.
    port: Number(process.env.PORT) || 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
