import { fileURLToPath, URL } from 'node:url';

import { mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import baseConfig from './vite.config.ts';

export default mergeConfig(baseConfig, {
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-widget',
    rollupOptions: {
      input: fileURLToPath(new URL('./widget.html', import.meta.url)),
    },
  },
});
