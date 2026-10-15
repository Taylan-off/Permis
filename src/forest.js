import * as THREE from 'three';
import { loadGlb } from './gltf.js';
import forestUrl from './assets/forest.glb?url';

/*
 * Décor « Route forestière » : scène USDZ fournie par l'utilisateur, convertie
 * avec tools/usd2gltf.py. C'est une miniature (route de 0,5 m dans le fichier) :
 * on l'agrandit 8 fois (route ≈ 4 m, arbres ≈ 20 m) et on place l'origine sur la
 * ligne droite du bas, où la voiture est garée, route orientée selon +X.
 */
export const FOREST_PLACEMENT = {
  // Véhicule 1,5× plus petit par rapport au décor qu'à l'échelle ×11.
  scale: 16.5,
  // Ligne droite du bas de la route (emplacement d'origine), décalée de 2,5 m vers
  // l'arrière de la voiture, là où le bord de route est le plus dégagé.
  origin: [0.05, 4.67, 1.24],
  rotationDeg: 0,
};

const FOLIAGE = /Atlas_0$|Atlas_0_1$|Bush|Vegetation|Fallen/;
const SOLID = /Trunk|Rock|Cliff|Fence|Log|Mud/;

export async function loadForest(onProgress) {
  const gltf = await loadGlb(forestUrl, onProgress);
  const root = gltf.scene;
  const { scale: S, origin: P, rotationDeg } = FOREST_PLACEMENT;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(rotationDeg));
  root.quaternion.copy(q);
  root.scale.setScalar(S);
  root.position.copy(new THREE.Vector3(...P).multiplyScalar(-S).applyQuaternion(q));
  root.name = 'forest';
  const meshes = [];
  const foliage = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    o.receiveShadow = true;
    o.castShadow = SOLID.test(o.name);
    if (FOLIAGE.test(o.name)) foliage.push(o);
    const m = o.material;
    if (m) {
      if (m.alphaTest > 0) { m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.alphaToCoverage = true; }
      if (m.map) m.map.anisotropy = 8;
      if (m.normalMap) m.normalMap.anisotropy = 2;
      m.envMapIntensity = 0.35;
    }
  });
  root.updateMatrixWorld(true);

  // Mise à niveau : le sol sous les quatre roues définit y = 0.
  const ground = meshes.filter((m) => !FOLIAGE.test(m.name) && !/Trunk/.test(m.name));
  const ray = new THREE.Raycaster();
  const heights = [];
  for (const [x, z] of [[1.37, -0.78], [1.37, 0.78], [-1.31, -0.78], [-1.31, 0.78], [0, 0]]) {
    ray.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(ground, false)[0];
    if (hit) heights.push(hit.point.y);
  }
  if (heights.length) {
    const avg = heights.reduce((a, b) => a + b, 0) / heights.length;
    root.position.y -= avg;
    root.updateMatrixWorld(true);
  }

  return {
    root,
    meshes,
    /** Ombres des feuillages (coûteuses, floues en basse résolution) : mode Ultra seulement. */
    setFoliageShadows(on) {
      for (const m of foliage) m.castShadow = on;
    },
  };
}
