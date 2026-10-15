import * as THREE from 'three';
import { materials as M } from './materials.js';
import { box, cylinderZ } from './geometry.js';

/*
 * Aménagement couchage, aux cotes relevées sur le modèle 3D du Touran
 * (repère scène : X vers l'avant, Y vers le haut, Z vers le côté passager).
 *
 *  - plancher du coffre : y = 0,475 m (de x = -1,85 à x = -1,15)
 *  - plancher sous l'ancienne banquette : y ≈ 0,60 m (x = -1,10 à -0,40)
 *  - face interne du hayon fermé : x = -1,92 m
 *  - dossiers des sièges avant (reculés) : x = -0,25 m
 *  - largeur libre entre passages de roue : 0,98 m jusqu'à y ≈ 0,80 m,
 *    puis 1,30 m au-dessus (x > -1,42) ; 0,98 m jusqu'à y ≈ 1,05 m tout à l'arrière
 *  - plafond : 1,47 m (arrière) à 1,60 m (milieu)
 */
export const LAYOUT = {
  trunkFloor: 0.475,
  seatRowFloor: 0.6,
  platformTop: 0.85,
  plate: 0.018,
  mattress: 0.08,
  rearX: -1.9,
  stepX: -1.42, // à partir d'ici le plateau peut passer au-dessus des passages de roue
  frontX: -0.26, // dossiers des sièges avant
  extensionX: 0.09, // bout de la rallonge (sièges avant avancés de 20 cm)
  narrowHalfWidth: 0.47,
  wideHalfWidth: 0.63,
  roofMin: 1.47,
};

export function buildInterior() {
  const L = LAYOUT;
  const root = new THREE.Group();
  const groups = {};
  const top = L.platformTop;
  const under = top - L.plate;

  // ── Plateforme ──────────────────────────────────────────────────────────
  groups.bed = new THREE.Group();
  const bed = groups.bed;
  bed.add(box([L.rearX, under, -L.narrowHalfWidth], [L.stepX, top, L.narrowHalfWidth], M.wood));
  bed.add(box([L.stepX, under, -L.wideHalfWidth], [L.frontX, top, L.wideHalfWidth], M.wood));
  // Panneaux porteurs longitudinaux (18 mm) posés sur le plancher, de part et d'autre.
  for (const s of [-1, 1]) {
    const z0 = s * 0.45;
    bed.add(box([L.rearX, L.trunkFloor, Math.min(z0, z0 + 0.018)], [-1.14, under, Math.max(z0, z0 + 0.018)], M.woodDark));
    bed.add(box([-1.14, L.seatRowFloor, Math.min(z0, z0 + 0.018)], [L.frontX, under, Math.max(z0, z0 + 0.018)], M.woodDark));
  }
  // Cloison centrale entre cuisine et rangements, zone coffre uniquement.
  bed.add(box([L.rearX, L.trunkFloor, -0.009], [-1.14, under, 0.009], M.woodDark));
  // Traverse avant.
  bed.add(box([L.frontX - 0.018, L.seatRowFloor, -0.45], [L.frontX, under, 0.45], M.woodDark));
  // Traverse au changement de largeur (appui sur les passages de roue).
  bed.add(box([L.stepX - 0.018, 0.8, -L.wideHalfWidth], [L.stepX, under, L.wideHalfWidth], M.woodDark));
  root.add(bed);

  // Rallonge : volet rabattable vers l'avant quand les sièges sont avancés.
  groups.extension = new THREE.Group();
  groups.extension.add(box([L.frontX, under, -0.55], [L.extensionX, top, 0.55], M.wood));
  groups.extension.add(box([L.frontX - 0.01, under - 0.02, -0.56], [L.frontX + 0.03, top + 0.005, 0.56], M.chrome)); // charnière piano
  groups.extension.visible = false;
  root.add(groups.extension);

  // ── Matelas, couette, oreillers ─────────────────────────────────────────
  groups.mattress = new THREE.Group();
  const mt = top + L.mattress;
  groups.mattress.add(box([L.rearX + 0.02, top, -L.narrowHalfWidth + 0.02], [L.stepX, mt, L.narrowHalfWidth - 0.02], M.mattress));
  groups.mattress.add(box([L.stepX, top, -L.wideHalfWidth + 0.02], [L.frontX - 0.02, mt, L.wideHalfWidth - 0.02], M.mattress));
  groups.mattress.add(box([L.rearX + 0.05, mt, -0.42], [-0.75, mt + 0.05, 0.42], M.blanket));
  groups.mattress.add(box([-0.72, mt, 0.04], [-0.3, mt + 0.09, 0.56], M.pillow));
  groups.mattress.add(box([-0.72, mt, -0.56], [-0.3, mt + 0.09, -0.04], M.pillow));
  root.add(groups.mattress);

  groups.mattressExtension = new THREE.Group();
  groups.mattressExtension.add(box([L.frontX - 0.02, top, -0.53], [L.extensionX - 0.02, mt, 0.53], M.mattress));
  groups.mattressExtension.visible = false;
  root.add(groups.mattressExtension);

  // ── Module cuisine coulissant (côté passager, sort par le hayon) ────────
  groups.kitchen = new THREE.Group();
  const drawer = new THREE.Group();
  const kx0 = L.rearX + 0.02;
  const kx1 = -1.16;
  const kz0 = 0.03;
  const kz1 = 0.44;
  const ky0 = L.trunkFloor + 0.015;
  const ky1 = under - 0.015;
  drawer.add(box([kx0, ky0, kz0], [kx1, ky0 + 0.015, kz1], M.woodDark)); // fond
  drawer.add(box([kx0, ky0, kz0], [kx1, ky1, kz0 + 0.015], M.woodDark)); // paroi
  drawer.add(box([kx0, ky0, kz1 - 0.015], [kx1, ky1, kz1], M.woodDark)); // paroi
  drawer.add(box([kx0, ky0, kz0], [kx0 + 0.018, ky1, kz1], M.wood)); // façade (côté hayon)
  drawer.add(box([kx1 - 0.015, ky0, kz0], [kx1, ky1, kz1], M.woodDark)); // fond du tiroir
  drawer.add(box([kx0 - 0.02, ky0 + 0.14, 0.18], [kx0, ky0 + 0.17, 0.29], M.chrome)); // poignée
  // Réchaud gaz un feu posé dans le tiroir.
  drawer.add(box([kx0 + 0.05, ky0 + 0.015, kz0 + 0.05], [kx0 + 0.33, ky0 + 0.065, kz1 - 0.05], M.steel));
  const burner = cylinderZ(0.065, 0.015, M.trim, 24);
  burner.rotation.x = Math.PI / 2;
  burner.position.set(kx0 + 0.19, ky0 + 0.075, (kz0 + kz1) / 2);
  drawer.add(burner);
  // Jerrican d'eau 10 L couché.
  drawer.add(box([kx0 + 0.38, ky0 + 0.015, kz0 + 0.06], [kx0 + 0.64, ky0 + 0.19, kz1 - 0.06], M.jerrycan));
  drawer.add(box([kx0 + 0.46, ky0 + 0.19, 0.2], [kx0 + 0.54, ky0 + 0.22, 0.27], M.trim));
  // Boîte couverts / vaisselle.
  drawer.add(box([kx0 + 0.66, ky0 + 0.015, kz0 + 0.05], [kx1 - 0.03, ky0 + 0.15, kz1 - 0.05], M.crate2));
  groups.kitchen.add(drawer);
  groups.kitchenDrawer = drawer;
  root.add(groups.kitchen);

  // ── Rangements ──────────────────────────────────────────────────────────
  groups.storage = new THREE.Group();
  // Caisses côté conducteur, zone coffre.
  groups.storage.add(box([L.rearX + 0.03, L.trunkFloor + 0.01, -0.44], [-1.5, L.trunkFloor + 0.16, -0.03], M.crate));
  groups.storage.add(box([L.rearX + 0.03, L.trunkFloor + 0.17, -0.44], [-1.5, L.trunkFloor + 0.32, -0.03], M.crate2));
  groups.storage.add(box([-1.47, L.trunkFloor + 0.01, -0.44], [-1.17, L.trunkFloor + 0.3, -0.03], M.crate));
  // Deux tiroirs plats sous l'ancienne banquette, accessibles par les portes arrière.
  const drawerL = new THREE.Group();
  drawerL.add(box([-1.1, L.seatRowFloor + 0.01, -0.44], [-0.3, under - 0.015, -0.03], M.woodDark));
  drawerL.add(box([-1.1, L.seatRowFloor + 0.01, -0.46], [-0.3, under - 0.015, -0.44], M.wood)); // façade côté porte
  drawerL.add(box([-0.76, L.seatRowFloor + 0.1, -0.475], [-0.64, L.seatRowFloor + 0.13, -0.46], M.chrome));
  const drawerR = new THREE.Group();
  drawerR.add(box([-1.1, L.seatRowFloor + 0.01, 0.03], [-0.3, under - 0.015, 0.44], M.woodDark));
  drawerR.add(box([-1.1, L.seatRowFloor + 0.01, 0.44], [-0.3, under - 0.015, 0.46], M.wood));
  drawerR.add(box([-0.76, L.seatRowFloor + 0.1, 0.46], [-0.64, L.seatRowFloor + 0.13, 0.475], M.chrome));
  groups.storage.add(drawerL, drawerR);
  groups.drawerL = drawerL;
  groups.drawerR = drawerR;
  root.add(groups.storage);

  return { root, groups };
}

/** Cotes utiles de l'aménagement, pour le panneau d'information. */
export function layoutSpecs() {
  const L = LAYOUT;
  const bedLength = L.frontX - L.rearX;
  const bedLengthExt = L.extensionX - L.rearX;
  return [
    ['Longueur couchage', `${bedLength.toFixed(2).replace('.', ',')} m`],
    ['… avec rallonge, sièges avancés', `${bedLengthExt.toFixed(2).replace('.', ',')} m`],
    ['Largeur à la tête / aux pieds', `${(2 * L.wideHalfWidth).toFixed(2).replace('.', ',')} / ${(2 * L.narrowHalfWidth).toFixed(2).replace('.', ',')} m`],
    ['Hauteur du plateau', `${L.platformTop.toFixed(2).replace('.', ',')} m`],
    ['Hauteur libre sur matelas', `${(L.roofMin - L.platformTop - L.mattress).toFixed(2).replace('.', ',')} à ${(1.6 - L.platformTop - L.mattress).toFixed(2).replace('.', ',')} m`],
    ['Hauteur de rangement (coffre)', `${(L.platformTop - L.plate - L.trunkFloor).toFixed(2).replace('.', ',')} m`],
    ['Hauteur de rangement (banquette)', `${(L.platformTop - L.plate - L.seatRowFloor).toFixed(2).replace('.', ',')} m`],
  ];
}
