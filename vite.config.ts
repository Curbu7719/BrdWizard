import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// `base` is '/' in dev (localhost:5173) and '/BrdWizard/' for the production
// build so assets resolve under the GitHub Pages project path
// (https://<user>.github.io/BrdWizard/).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/BrdWizard/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
}));
