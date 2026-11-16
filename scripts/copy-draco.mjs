// Copies the Draco decoder from three into public/draco so no CDN is needed.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/three/examples/jsm/libs/draco/gltf/';
const dst = 'public/draco/';
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) cpSync(src + f, dst + f);
  console.log('Draco decoder copied to public/draco');
}
