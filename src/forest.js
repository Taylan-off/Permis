import * as THREE from 'three';
import { loadGlb } from './gltf.js';
import forestUrl from './assets/forest.glb?url';

/*
 * Décor « Route forestière » : scène USDZ fournie par l'utilisateur, convertie
 * avec tools/usd2gltf.py. C'est une miniature (route de 0,5 m dans le fichier) :
 * on l'agrandit 8 fois (route ≈ 4 m, arbres ≈ 20 m) et on place l'origine sur la
 * ligne droite du bas, où la voiture est garée, route orientée selon +X.
 */
export const FOREST_PLACEMENT = { scale: 8, origin: [0.9, 4.67, 1.12] };

const FOLIAGE = /Atlas_0$|Atlas_0_1$|Bush|Vegetation|Fallen|Trunk/;

export async function loadForest(onProgress) {
  const gltf = await loadGlb(forestUrl, onProgress);
  const root = gltf.scene;
  const { scale: S, origin: P } = FOREST_PLACEMENT;
  root.scale.setScalar(S);
  root.position.set(-P[0] * S, -P[1] * S, -P[2] * S);
  root.name = 'forest';
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    o.receiveShadow = true;
    o.castShadow = /Trunk|Rock|Cliff|Fence|Log/.test(o.name);
    const m = o.material;
    if (m) {
      if (m.alphaTest > 0) { m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.alphaToCoverage = true; }
      if (m.map) m.map.anisotropy = 8;
      if (m.normalMap) m.normalMap.anisotropy = 2;
      m.envMapIntensity = 0.35;
    }
  });
  root.updateMatrixWorld(true);
  return { root, meshes };
}
