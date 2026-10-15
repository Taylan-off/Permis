import * as THREE from 'three';

export const materials = {
  paint: new THREE.MeshPhysicalMaterial({
    color: '#2b5797',
    metalness: 0.55,
    roughness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: '#6fa3c7',
    metalness: 0.1,
    roughness: 0.05,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
  }),
  trim: new THREE.MeshStandardMaterial({ color: '#1c1f24', roughness: 0.75 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#d8dde3', metalness: 0.95, roughness: 0.15 }),
  tyre: new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.95 }),
  rim: new THREE.MeshStandardMaterial({ color: '#c4c9cf', metalness: 0.9, roughness: 0.25 }),
  interior: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.9 }),
  interiorLight: new THREE.MeshStandardMaterial({ color: '#8c9199', roughness: 0.9 }),
  seat: new THREE.MeshStandardMaterial({ color: '#2d3139', roughness: 0.95 }),
  wood: new THREE.MeshStandardMaterial({ color: '#c9a06b', roughness: 0.7 }),
  woodDark: new THREE.MeshStandardMaterial({ color: '#8c6a3e', roughness: 0.75 }),
  mattress: new THREE.MeshStandardMaterial({ color: '#e9e2d3', roughness: 1 }),
  blanket: new THREE.MeshStandardMaterial({ color: '#7a9e7e', roughness: 1 }),
  pillow: new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 1 }),
  crate: new THREE.MeshStandardMaterial({ color: '#4a6fa5', roughness: 0.6 }),
  crate2: new THREE.MeshStandardMaterial({ color: '#a54a4a', roughness: 0.6 }),
  steel: new THREE.MeshStandardMaterial({ color: '#9ea5ad', metalness: 0.8, roughness: 0.35 }),
  jerrycan: new THREE.MeshStandardMaterial({ color: '#2f7bd6', roughness: 0.5 }),
  headlight: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dfe9ff', emissiveIntensity: 0.6 }),
  taillight: new THREE.MeshStandardMaterial({ color: '#b3111c', emissive: '#ff2a2a', emissiveIntensity: 0.35 }),
  ground: new THREE.MeshStandardMaterial({ color: '#1b2129', roughness: 1 }),
};

/** Toggle the "x-ray" look on the body paint. */
export function setXray(enabled) {
  materials.paint.transparent = enabled;
  materials.paint.opacity = enabled ? 0.22 : 1;
  materials.paint.depthWrite = !enabled;
  materials.paint.needsUpdate = true;
}

export function setPaintColor(hex) {
  materials.paint.color.set(hex);
}
