import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/*
 * Chargement glTF robuste, partagé par le véhicule et le décor :
 *  - data: URL décodé en mémoire (Safari refuse le fetch d'un gros data: URL) ;
 *  - textures WebP embarquées décodées depuis leurs octets, sans URL blob.
 */

/**
 * Décodage des textures WebP sans fetch ni URL blob : Safari refuse le fetch
 * d'un gros data: URL (« Load failed ») et certains hébergements interdisent
 * les blob:. On lit les octets du bufferView et on crée l'image directement.
 * Remplace l'extension EXT_texture_webp intégrée (même nom → priorité).
 */
const WEBGL_FILTERS = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
};
const WEBGL_WRAPPINGS = {
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping,
};

async function imageFromBytes(bytes, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (e) {
      console.warn('createImageBitmap a échoué, repli sur <img>', e);
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const img = new Image();
  img.src = `data:${mimeType};base64,${btoa(binary)}`;
  await img.decode();
  return img;
}

export class EmbeddedTexturePlugin {
  constructor(parser) {
    this.parser = parser;
    this.name = 'EXT_texture_webp';
    this.cache = new Map();
  }

  loadTexture(textureIndex) {
    const { parser, name } = this;
    const json = parser.json;
    const textureDef = json.textures[textureIndex];
    const ext = textureDef.extensions?.[name];
    if (!ext) return null;
    const source = json.images[ext.source];
    if (source.bufferView === undefined) return null; // image externe : chemin standard

    if (!this.cache.has(ext.source)) {
      this.cache.set(ext.source, parser.getDependency('bufferView', source.bufferView)
        .then((bufferView) => imageFromBytes(new Uint8Array(bufferView), source.mimeType || 'image/webp')));
    }
    return this.cache.get(ext.source).then((image) => {
      const texture = new THREE.Texture(image);
      texture.needsUpdate = true;
      texture.flipY = false;
      texture.name = textureDef.name || source.name || '';
      const sampler = (json.samplers || [])[textureDef.sampler] || {};
      texture.magFilter = WEBGL_FILTERS[sampler.magFilter] || THREE.LinearFilter;
      texture.minFilter = WEBGL_FILTERS[sampler.minFilter] || THREE.LinearMipmapLinearFilter;
      texture.wrapS = WEBGL_WRAPPINGS[sampler.wrapS] || THREE.RepeatWrapping;
      texture.wrapT = WEBGL_WRAPPINGS[sampler.wrapT] || THREE.RepeatWrapping;
      texture.generateMipmaps = texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter;
      parser.associations.set(texture, { textures: textureIndex });
      return texture;
    });
  }
}

/** Lit le modèle : data: URL décodé en mémoire, sinon fetch classique. */
export async function fetchModel(url, onProgress) {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const header = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    if (!header.includes('base64')) return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    onProgress?.({ loaded: 1, total: 1 });
    return bytes.buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}


/** Charge un .glb (URL ou data: URL) avec décodage meshopt et textures robustes. */
export async function loadGlb(url, onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register((parser) => new EmbeddedTexturePlugin(parser));
  const buffer = await fetchModel(url, onProgress);
  return loader.parseAsync(buffer, '');
}
