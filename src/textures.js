import * as THREE from 'three';

/*
 * Textures procédurales dessinées au canvas (aucun fichier à charger) :
 * contreplaqué de bouleau, chant de contreplaqué (plis), tissu de matelas,
 * couverture tricotée, plastique de caisse.
 */

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bruit de valeur lissé 2D, tuilable sur `size`. */
function valueNoise(size, cells, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const v = (xx, yy) => g[((yy % cells) + cells) % cells * cells + (((xx % cells) + cells) % cells)];
      const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
      const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

function makeTexture(size, paint, { repeat = [1, 1], srgb = true, anisotropy = 8 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  paint(img.data, size);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

const cache = {};

/** Contreplaqué de bouleau : veinage fin, légères variations, petits nœuds. */
export function plywoodTexture() {
  if (cache.plywood) return cache.plywood;
  const size = 512;
  const n1 = valueNoise(size, 6, 11);
  const n2 = valueNoise(size, 48, 12);
  const n3 = valueNoise(size, 160, 13);
  cache.plywood = makeTexture(size, (d) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        // Veinage : bandes le long de x, déformées par un bruit basse fréquence.
        const grain = Math.sin((y + n1[i] * 90 + n2[i] * 14) * 0.35) * 0.5 + 0.5;
        const fine = n3[i];
        let r = 214, g = 186, b = 140;
        const k = 0.86 + grain * 0.12 + fine * 0.06 + (n1[i] - 0.5) * 0.08;
        r *= k; g *= k * 0.98; b *= k * 0.95;
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
    }
  }, { repeat: [1, 1] });
  return cache.plywood;
}

/** Chant de contreplaqué : plis alternés clair / sombre. */
export function plywoodEdgeTexture() {
  if (cache.edge) return cache.edge;
  const size = 128;
  const n = valueNoise(size, 24, 21);
  cache.edge = makeTexture(size, (d) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const ply = Math.floor((y / size) * 9) % 2 === 0;
        const k = (ply ? 1.0 : 0.78) + (n[i] - 0.5) * 0.1;
        d[i * 4] = 210 * k; d[i * 4 + 1] = 180 * k; d[i * 4 + 2] = 132 * k; d[i * 4 + 3] = 255;
      }
    }
  }, { repeat: [8, 1] });
  return cache.edge;
}

/** Tissu de matelas : trame fine + matelassage en losanges. */
export function mattressTexture() {
  if (cache.mattress) return cache.mattress;
  const size = 512;
  const n = valueNoise(size, 200, 31);
  const n2 = valueNoise(size, 12, 32);
  cache.mattress = makeTexture(size, (d) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const weave = ((x & 1) ^ (y & 1)) ? 0.03 : 0;
        const quilt = Math.abs(Math.sin((x + y) * Math.PI / 64)) < 0.04 || Math.abs(Math.sin((x - y) * Math.PI / 64)) < 0.04 ? -0.08 : 0;
        const k = 0.9 + n[i] * 0.08 + (n2[i] - 0.5) * 0.06 + weave + quilt;
        d[i * 4] = 236 * k; d[i * 4 + 1] = 230 * k; d[i * 4 + 2] = 218 * k; d[i * 4 + 3] = 255;
      }
    }
  }, { repeat: [3, 2] });
  return cache.mattress;
}

/** Couverture : mailles tricotées, teinte sauge. */
export function blanketTexture() {
  if (cache.blanket) return cache.blanket;
  const size = 256;
  const n = valueNoise(size, 64, 41);
  cache.blanket = makeTexture(size, (d) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const knit = (Math.sin(x * Math.PI / 6) * Math.sin(y * Math.PI / 4)) * 0.5 + 0.5;
        const k = 0.8 + knit * 0.22 + (n[i] - 0.5) * 0.12;
        d[i * 4] = 118 * k; d[i * 4 + 1] = 150 * k; d[i * 4 + 2] = 122 * k; d[i * 4 + 3] = 255;
      }
    }
  }, { repeat: [6, 6] });
  return cache.blanket;
}

/** Plastique de caisse : grain léger. */
export function plasticTexture() {
  if (cache.plastic) return cache.plastic;
  const size = 128;
  const n = valueNoise(size, 64, 51);
  cache.plastic = makeTexture(size, (d) => {
    for (let i = 0; i < size * size; i++) {
      const k = 0.92 + n[i] * 0.12;
      d[i * 4] = 255 * k; d[i * 4 + 1] = 255 * k; d[i * 4 + 2] = 255 * k; d[i * 4 + 3] = 255;
    }
  }, { repeat: [4, 4], srgb: false });
  return cache.plastic;
}

/** Carte de rugosité générique à partir d'un bruit (pour casser les reflets uniformes). */
export function roughnessNoiseTexture() {
  if (cache.rough) return cache.rough;
  const size = 256;
  const n = valueNoise(size, 80, 61);
  cache.rough = makeTexture(size, (d) => {
    for (let i = 0; i < size * size; i++) {
      const v = 180 + n[i] * 60;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  }, { repeat: [4, 4], srgb: false });
  return cache.rough;
}
