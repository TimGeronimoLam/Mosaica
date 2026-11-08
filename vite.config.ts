import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * ONNX Runtime refers to its WebAssembly by URL, so Vite copies a 26 MB .wasm
 * into dist/ although Transformers.js fetches the runtime from jsDelivr at run
 * time. Cloudflare refuses assets that large, so the copy is dropped.
 */
function dropOnnxWasm(): Plugin {
  return {
    name: 'drop-onnx-wasm',
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

export default defineConfig({
  plugins: [react(), dropOnnxWasm()],
  base: './',
  // Transformers.js loads ONNX Runtime at run time and does not survive dependency pre-bundling.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
  },
});
