import * as THREE from 'three';

/** Matériaux de l'aménagement (le véhicule a les siens dans vehicle.js). */
export const materials = {
  wood: new THREE.MeshStandardMaterial({ color: '#d2a86f', roughness: 0.7 }),
  woodDark: new THREE.MeshStandardMaterial({ color: '#8c6a3e', roughness: 0.75 }),
  mattress: new THREE.MeshStandardMaterial({ color: '#cfc7b6', roughness: 1 }),
  blanket: new THREE.MeshStandardMaterial({ color: '#7a9e7e', roughness: 1 }),
  pillow: new THREE.MeshStandardMaterial({ color: '#ddd7cc', roughness: 1 }),
  crate: new THREE.MeshStandardMaterial({ color: '#4a6fa5', roughness: 0.6 }),
  crate2: new THREE.MeshStandardMaterial({ color: '#a54a4a', roughness: 0.6 }),
  steel: new THREE.MeshStandardMaterial({ color: '#9ea5ad', metalness: 0.8, roughness: 0.35 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#d8dde3', metalness: 0.95, roughness: 0.15 }),
  trim: new THREE.MeshStandardMaterial({ color: '#1c1f24', roughness: 0.75 }),
  jerrycan: new THREE.MeshStandardMaterial({ color: '#2f7bd6', roughness: 0.5 }),
  ground: new THREE.MeshStandardMaterial({ color: '#1b2129', roughness: 1 }),
};
