import { defineConfig } from 'vite';

/**
 * three's DRACOLoader has default decoder URLs (new URL(..., import.meta.url)),
 * which makes Vite emit a second copy of the decoder. The game always calls
 * setDecoderPath('draco/') with the copy in public/, so drop the defaults.
 */
const dropDracoDefaults = {
  name: 'drop-draco-defaults',
  transform(code, id) {
    if (!id.includes('DRACOLoader')) return null;
    return code.replace(/new URL\(\s*'\.\.\/libs\/draco\/[^']+',\s*import\.meta\.url\s*\)\.toString\(\)/g, "''");
  },
};

export default defineConfig({
  base: './',
  plugins: [dropDracoDefaults],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 60000,
  },
});
