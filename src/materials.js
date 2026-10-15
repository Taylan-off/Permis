import * as THREE from 'three';
import { plywoodTexture, plywoodEdgeTexture, mattressTexture, blanketTexture, plasticTexture, roughnessNoiseTexture } from './textures.js';

/** Matériaux de l'aménagement (le véhicule a les siens dans vehicle.js). */
export const materials = {
  wood: new THREE.MeshStandardMaterial({ map: plywoodTexture(), roughness: 0.62, metalness: 0, roughnessMap: roughnessNoiseTexture() }),
  woodEdge: new THREE.MeshStandardMaterial({ map: plywoodEdgeTexture(), roughness: 0.75, metalness: 0 }),
  woodDark: new THREE.MeshStandardMaterial({ map: plywoodTexture(), color: '#b89468', roughness: 0.7, metalness: 0 }),
  mattress: new THREE.MeshStandardMaterial({ map: mattressTexture(), roughness: 0.95, metalness: 0 }),
  blanket: new THREE.MeshStandardMaterial({ map: blanketTexture(), roughness: 1, metalness: 0 }),
  pillow: new THREE.MeshStandardMaterial({ map: mattressTexture(), color: '#f6f3ec', roughness: 0.95, metalness: 0 }),
  crate: new THREE.MeshStandardMaterial({ map: plasticTexture(), color: '#3f5f8e', roughness: 0.55, metalness: 0 }),
  crate2: new THREE.MeshStandardMaterial({ map: plasticTexture(), color: '#8c3f3f', roughness: 0.55, metalness: 0 }),
  crateLid: new THREE.MeshStandardMaterial({ map: plasticTexture(), color: '#2c3744', roughness: 0.5, metalness: 0 }),
  steel: new THREE.MeshStandardMaterial({ color: '#a9afb6', metalness: 0.85, roughness: 0.3 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#d8dde3', metalness: 0.95, roughness: 0.15 }),
  trim: new THREE.MeshStandardMaterial({ color: '#1c1f24', roughness: 0.75 }),
  jerrycan: new THREE.MeshStandardMaterial({ map: plasticTexture(), color: '#2f7bd6', roughness: 0.45, metalness: 0 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.95 }),
  ground: new THREE.MeshStandardMaterial({ color: '#1b2129', roughness: 1 }),
};
