// A tiny stand-in for three's DRACOLoader that runs in Node (tests and scripts):
// decodes on the main thread with the draco3dgltf package (a dev dependency).
import * as THREE from 'three';
import draco3d from 'draco3dgltf';

let modP = null;
const decoderModule = () => (modP ||= draco3d.createDecoderModule({}));

const TYPES = { Float32Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array };
const DT = (draco, T) => ({
  Float32Array: draco.DT_FLOAT32, Int8Array: draco.DT_INT8, Int16Array: draco.DT_INT16, Int32Array: draco.DT_INT32,
  Uint8Array: draco.DT_UINT8, Uint16Array: draco.DT_UINT16, Uint32Array: draco.DT_UINT32,
}[T.name]);

export class NodeDracoLoader {
  preload() { decoderModule(); return this; }
  dispose() {}
  decodeDracoFile(buffer, callback, attributeIDs, attributeTypes, _cs, onError = () => {}) {
    return decoderModule().then((draco) => {
      const decoder = new draco.Decoder();
      const array = new Int8Array(buffer);
      const mesh = new draco.Mesh();
      const status = decoder.DecodeArrayToMesh(array, array.byteLength, mesh);
      if (!status.ok() || mesh.ptr === 0) throw new Error('Draco decode failed: ' + status.error_msg());
      const geo = new THREE.BufferGeometry();
      for (const name in attributeIDs) {
        const T = TYPES[attributeTypes[name]] || Float32Array;
        const att = decoder.GetAttributeByUniqueId(mesh, attributeIDs[name]);
        const n = mesh.num_points() * att.num_components();
        const bytes = n * T.BYTES_PER_ELEMENT;
        const ptr = draco._malloc(bytes);
        decoder.GetAttributeDataArrayForAllPoints(mesh, att, DT(draco, T), bytes, ptr);
        const arr = new T(draco.HEAPF32.buffer, ptr, n).slice();
        draco._free(ptr);
        geo.setAttribute(name, new THREE.BufferAttribute(arr, att.num_components()));
      }
      const nIdx = mesh.num_faces() * 3;
      const ptr = draco._malloc(nIdx * 4);
      decoder.GetTrianglesUInt32Array(mesh, nIdx * 4, ptr);
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(draco.HEAPF32.buffer, ptr, nIdx).slice(), 1));
      draco._free(ptr);
      draco.destroy(mesh); draco.destroy(decoder);
      callback(geo);
    }).catch(onError);
  }
}
