import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/** One shared glTF loader with the local Draco decoder (no CDN). */
let loader = null;

export function gltfLoader() {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('draco/', document.baseURI).href);
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  // hub.glb has two textures with no image source (the microscope monitor,
  // MCB_SEM_MonImage). GLTFLoader throws on those, so skip them instead.
  loader.register((parser) => ({
    name: 'MCB_skip_sourceless_textures',
    loadTexture(index) {
      const def = parser.json.textures[index];
      const ext = def.extensions || {};
      const hasSource = def.source !== undefined || Object.values(ext).some((e) => e && e.source !== undefined);
      if (hasSource) return null;
      console.info(`Skipped glTF texture ${index}: it has no image source.`);
      return Promise.resolve(null);
    },
  }));
  return loader;
}

/**
 * @param {string} url relative to the page
 * @param {(fraction:number)=>void} [onProgress]
 * @returns {Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>}
 */
export function loadGLTF(url, onProgress) {
  return new Promise((resolve, reject) => {
    gltfLoader().load(
      url,
      resolve,
      (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); },
      reject,
    );
  });
}
