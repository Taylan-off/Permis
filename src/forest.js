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
  origin: [0.02, 4.67, 1.27],
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
  root.updateMatrixWorld(true);
  // Les maillages du fichier couvrent chacun toute la scène (un seul maillage pour
  // tous les sapins…) : impossible à écarter du rendu quand ils sortent du champ.
  // On les découpe en dalles de 14 m ; chaque dalle est éliminée hors champ
  // (frustum) et au-delà de la distance d'affichage.
  // Clairière : les arbres (troncs et houppiers) à moins de CLEAR_RADIUS de la
  // voiture sont supprimés pour que la caméra puisse tourner sans collision.
  const CLEAR_RADIUS = 9;
  const vv = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry.index || !/Atlas_0$|Atlas_0_1$|Trunk|Bush/.test(o.name)) return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index.array;
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      vv.fromBufferAttribute(pos, idx[t]).applyMatrix4(o.matrixWorld);
      if (Math.hypot(vv.x, vv.z) >= CLEAR_RADIUS) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    if (keep.length !== idx.length) o.geometry.setIndex(keep);
  });

  const CELL = 14;
  const toSplit = [];
  root.traverse((o) => { if (o.isMesh && o.geometry.index && o.geometry.index.count > 3000) toSplit.push(o); });
  for (const mesh of toSplit) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index.array;
    const v = new THREE.Vector3();
    const buckets = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      v.fromBufferAttribute(pos, idx[t]).applyMatrix4(mesh.matrixWorld);
      const key = `${Math.floor(v.x / CELL)},${Math.floor(v.z / CELL)}`;
      let b = buckets.get(key);
      if (!b) { b = []; buckets.set(key, b); }
      b.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    if (buckets.size < 2) continue;
    const parent = mesh.parent;
    parent.remove(mesh);
    for (const [key, ids] of buckets) {
      const g = new THREE.BufferGeometry();
      for (const [k, attr] of Object.entries(geo.attributes)) g.setAttribute(k, attr);
      g.setIndex(ids);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mesh.material);
      m.name = mesh.name;
      m.position.copy(mesh.position);
      m.quaternion.copy(mesh.quaternion);
      m.scale.copy(mesh.scale);
      m.userData.chunk = key;
      parent.add(m);
    }
  }
  root.updateMatrixWorld(true);

  const meshes = [];
  const foliage = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    o.userData.center = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
    o.userData.radius = o.geometry.boundingSphere.radius * o.getWorldScale(new THREE.Vector3()).x;
    o.receiveShadow = true;
    o.castShadow = SOLID.test(o.name);
    if (FOLIAGE.test(o.name)) foliage.push(o);
    const m = o.material;
    if (m) {
      if (m.alphaTest > 0) { m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.alphaToCoverage = true; }
      if (m.map) m.map.anisotropy = 4;
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

  let foliageShadows = false;
  let viewDistance = 200;
  const SHADOW_DISTANCE = 45;
  const camPos = new THREE.Vector3();
  const api = {
    root,
    meshes,
    /** Ombres des feuillages (coûteuses, floues en basse résolution) : mode Ultra seulement. */
    setFoliageShadows(on) {
      foliageShadows = on;
      for (const m of foliage) m.castShadow = on && m.userData.center.length() < SHADOW_DISTANCE;
    },
    setViewDistance(d) { viewDistance = d; },
    get viewDistance() { return viewDistance; },
    /** À chaque image : masque les dalles trop loin de la caméra ; ombres seulement près de la voiture. */
    cull(camera) {
      camera.getWorldPosition(camPos);
      for (const m of meshes) {
        const d = m.userData.center.distanceTo(camPos) - m.userData.radius;
        m.visible = d < viewDistance;
        if (!m.visible) continue;
        const nearCar = m.userData.center.length() - m.userData.radius < SHADOW_DISTANCE;
        m.castShadow = nearCar && (FOLIAGE.test(m.name) ? foliageShadows : SOLID.test(m.name));
      }
    },
  };
  api.setFoliageShadows(false);
  return api;
}
