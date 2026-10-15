//! yft2gltf — exporte un fragment véhicule GTA V (.yft + .ytd) en glTF binaire.
//!
//! Chaque os du squelette (chassis, door_dside_f, bonnet, boot, wheel_lf…)
//! devient un nœud glTF nommé, positionné par la pose par défaut du fragment,
//! avec ses sommets en coordonnées locales : le pivot du nœud est la charnière.
//! Le nœud racine convertit l'espace Z-up de RAGE en Y-up glTF.

use anyhow::{anyhow, Context, Result};
use rage_formats::resource::{prepare_rsc7_system, SYSTEM_BASE};
use rage_formats::texture_utils::{encode_image, fit_max_size, to_rgba_image, ImageFormat};
use rage_formats::{parse_yft, parse_ytd, rage_joaat, Drawable, Mat4, Vec3, Vec4, VertexSemantic, YtdTexture};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

// ─── Squelette ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Bone {
    name: String,
    tag: u16,
    index: i16,
    parent: i16,
    rotation: Vec4,
    translation: Vec3,
}

fn vec3_at(b: &[u8], o: usize) -> Vec3 {
    Vec3::new(f32_at(b, o), f32_at(b, o + 4), f32_at(b, o + 8))
}
fn vec4_at(b: &[u8], o: usize) -> Vec4 {
    Vec4::new(f32_at(b, o), f32_at(b, o + 4), f32_at(b, o + 8), f32_at(b, o + 12))
}
fn f32_at(b: &[u8], o: usize) -> f32 {
    f32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}

fn quat_conj(q: Vec4) -> Vec4 {
    Vec4::new(-q.x, -q.y, -q.z, q.w)
}

fn quat_normalize(q: Vec4) -> Vec4 {
    let n = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).sqrt();
    if n < 1e-6 { Vec4::new(0.0, 0.0, 0.0, 1.0) } else { Vec4::new(q.x / n, q.y / n, q.z / n, q.w / n) }
}

/// Transformation monde (rotation, translation) de chaque os, composée via les parents.
fn bone_world_transforms(bones: &[Bone]) -> Vec<(Vec4, Vec3)> {
    let mut world: Vec<Option<(Vec4, Vec3)>> = vec![None; bones.len()];
    fn resolve(i: usize, bones: &[Bone], world: &mut Vec<Option<(Vec4, Vec3)>>, depth: usize) -> (Vec4, Vec3) {
        if let Some(w) = world[i] { return w; }
        let b = &bones[i];
        let local_q = quat_normalize(b.rotation);
        let w = if b.parent < 0 || b.parent as usize >= bones.len() || depth > 64 {
            (local_q, b.translation)
        } else {
            let (pq, pt) = resolve(b.parent as usize, bones, world, depth + 1);
            let t = pq.quat_rotate(b.translation);
            (quat_normalize(pq.quat_mul(local_q)), Vec3::new(pt.x + t.x, pt.y + t.y, pt.z + t.z))
        };
        world[i] = Some(w);
        w
    }
    (0..bones.len()).map(|i| resolve(i, bones, &mut world, 0)).collect()
}

fn sys_slice(system: &[u8], va: u64, len: usize) -> Option<&[u8]> {
    if va < SYSTEM_BASE {
        return None;
    }
    let off = (va - SYSTEM_BASE) as usize;
    system.get(off..off.checked_add(len)?)
}

fn u64_at(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}
fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes(b[o..o + 2].try_into().unwrap())
}
fn i16_at(b: &[u8], o: usize) -> i16 {
    i16::from_le_bytes(b[o..o + 2].try_into().unwrap())
}

fn string_at(system: &[u8], va: u64) -> String {
    let Some(start) = sys_slice(system, va, 1) else { return String::new() };
    let off = start.as_ptr() as usize - system.as_ptr() as usize;
    let end = system[off..].iter().position(|&c| c == 0).map(|p| off + p).unwrap_or(system.len());
    String::from_utf8_lossy(&system[off..end]).into_owned()
}

/// Lit les os du squelette du drawable principal du fragment.
fn read_bones(system: &[u8]) -> Result<Vec<Bone>> {
    let frag = sys_slice(system, SYSTEM_BASE, 0x60).ok_or_else(|| anyhow!("FragType trop court"))?;
    let drawable_ptr = u64_at(frag, 0x30);
    let dr = sys_slice(system, drawable_ptr, 0x20).ok_or_else(|| anyhow!("drawable introuvable"))?;
    let skel_ptr = u64_at(dr, 0x18);
    if skel_ptr == 0 {
        return Ok(Vec::new());
    }
    let sk = sys_slice(system, skel_ptr, 0x70).ok_or_else(|| anyhow!("squelette introuvable"))?;
    let bones_ptr = u64_at(sk, 0x20);
    let count = u16_at(sk, 0x5E) as usize;
    let mut bones = Vec::with_capacity(count);
    for i in 0..count {
        let b = sys_slice(system, bones_ptr + 80 * i as u64, 80).ok_or_else(|| anyhow!("os {i} hors limites"))?;
        bones.push(Bone {
            name: string_at(system, u64_at(b, 0x38)),
            tag: u16_at(b, 0x44),
            index: i16_at(b, 0x42),
            parent: i16_at(b, 0x32),
            rotation: vec4_at(b, 0x00),
            translation: vec3_at(b, 0x10),
        });
    }
    Ok(bones)
}

// ─── Shaders ─────────────────────────────────────────────────────────────────

const SHADER_NAMES: &[&str] = &[
    "vehicle_paint1", "vehicle_paint2", "vehicle_paint3", "vehicle_paint4", "vehicle_paint5_enveff",
    "vehicle_paint6", "vehicle_paint7", "vehicle_paint8", "vehicle_paint9", "vehicle_paint1_enveff",
    "vehicle_paint2_enveff", "vehicle_paint3_enveff", "vehicle_paint3_lvr", "vehicle_paint4_enveff",
    "vehicle_paint4_emissive", "vehicle_paint6_enveff", "vehicle_paint7_enveff", "vehicle_mesh",
    "vehicle_mesh2_enveff", "vehicle_mesh_enveff", "vehicle_vehglass", "vehicle_vehglass_inner",
    "vehicle_tire", "vehicle_tire_emissive", "vehicle_interior", "vehicle_interior2",
    "vehicle_lightsemissive", "vehicle_dash_emissive", "vehicle_dash_emissive_opaque", "vehicle_badges",
    "vehicle_decal", "vehicle_decal2", "vehicle_detail", "vehicle_detail2", "vehicle_generic",
    "vehicle_shuts", "vehicle_basic", "vehicle_licenseplate", "vehicle_cutout", "vehicle_blurredrotor",
    "vehicle_blurredrotor_emissive", "vehicle_track", "vehicle_track2", "vehicle_track_emissive",
    "vehicle_track2_emissive", "vehicle_cloth", "vehicle_cloth2", "vehicle_nosplash", "vehicle_nowater",
    "vehicle_emissive_opaque", "vehicle_emissive_alpha", "default", "normal", "normal_spec", "spec",
    "emissive", "glass", "default_tnt", "normal_spec_tnt",
];

fn shader_table() -> HashMap<u32, &'static str> {
    let mut m = HashMap::new();
    for n in SHADER_NAMES {
        m.insert(rage_joaat(n), *n);
        m.insert(rage_joaat(&format!("{n}.sps")), *n);
    }
    m
}

// ─── GLB ─────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Glb {
    bin: Vec<u8>,
    buffer_views: Vec<Value>,
    accessors: Vec<Value>,
    meshes: Vec<Value>,
    nodes: Vec<Value>,
    materials: Vec<Value>,
    images: Vec<Value>,
    textures: Vec<Value>,
    material_cache: HashMap<String, usize>,
    texture_cache: HashMap<String, Option<usize>>,
}

impl Glb {
    fn push_view(&mut self, data: &[u8], target: Option<u32>) -> usize {
        while self.bin.len() % 4 != 0 {
            self.bin.push(0);
        }
        let offset = self.bin.len();
        self.bin.extend_from_slice(data);
        let mut v = json!({ "buffer": 0, "byteOffset": offset, "byteLength": data.len() });
        if let Some(t) = target {
            v["target"] = json!(t);
        }
        self.buffer_views.push(v);
        self.buffer_views.len() - 1
    }

    fn push_f32_accessor(&mut self, data: &[f32], comps: usize, kind: &str, with_bounds: bool) -> usize {
        let bytes: Vec<u8> = data.iter().flat_map(|f| f.to_le_bytes()).collect();
        let view = self.push_view(&bytes, Some(34962));
        let count = data.len() / comps;
        let mut acc = json!({ "bufferView": view, "componentType": 5126, "count": count, "type": kind });
        if with_bounds {
            let mut min = vec![f32::INFINITY; comps];
            let mut max = vec![f32::NEG_INFINITY; comps];
            for v in data.chunks(comps) {
                for (i, x) in v.iter().enumerate() {
                    min[i] = min[i].min(*x);
                    max[i] = max[i].max(*x);
                }
            }
            acc["min"] = json!(min);
            acc["max"] = json!(max);
        }
        self.accessors.push(acc);
        self.accessors.len() - 1
    }

    fn push_index_accessor(&mut self, indices: &[u32]) -> usize {
        let bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
        let view = self.push_view(&bytes, Some(34963));
        self.accessors.push(json!({ "bufferView": view, "componentType": 5125, "count": indices.len(), "type": "SCALAR" }));
        self.accessors.len() - 1
    }

    fn texture(&mut self, name: &str, textures: &HashMap<String, YtdTexture>, max_size: u32) -> Option<usize> {
        let key = name.to_ascii_lowercase();
        if let Some(t) = self.texture_cache.get(&key) {
            return *t;
        }
        let result = (|| -> Result<usize> {
            let tex = textures.get(&key).ok_or_else(|| anyhow!("texture absente"))?;
            let img = to_rgba_image(tex)?;
            let img = fit_max_size(img, max_size);
            let png = encode_image(&img, ImageFormat::Png, 90)?;
            let view = self.push_view(&png, None);
            self.images.push(json!({ "name": key, "mimeType": "image/png", "bufferView": view }));
            self.textures.push(json!({ "sampler": 0, "source": self.images.len() - 1 }));
            Ok(self.textures.len() - 1)
        })();
        let idx = match result {
            Ok(i) => Some(i),
            Err(e) => {
                eprintln!("  texture {key}: {e}");
                None
            }
        };
        self.texture_cache.insert(key, idx);
        idx
    }

    fn material(
        &mut self,
        shader: &str,
        diffuse: Option<&str>,
        bucket: u8,
        textures: &HashMap<String, YtdTexture>,
        max_size: u32,
    ) -> usize {
        let diffuse_key = diffuse.map(|d| d.to_ascii_lowercase()).unwrap_or_default();
        let key = format!("{shader}|{diffuse_key}");
        if let Some(i) = self.material_cache.get(&key) {
            return *i;
        }
        let is_glass = shader.contains("glass");
        let is_paint = shader.starts_with("vehicle_paint");
        let mut pbr = json!({ "metallicFactor": if is_paint { 0.6 } else { 0.0 }, "roughnessFactor": if is_glass { 0.1 } else { 0.7 } });
        if is_glass {
            pbr["baseColorFactor"] = json!([0.55, 0.7, 0.8, 0.35]);
        } else if !is_paint {
            if let Some(d) = diffuse {
                if let Some(t) = self.texture(d, textures, max_size) {
                    pbr["baseColorTexture"] = json!({ "index": t });
                }
            }
        }
        let mut mat = json!({
            "name": key,
            "pbrMetallicRoughness": pbr,
            "extras": { "shader": shader, "diffuse": diffuse_key, "bucket": bucket },
        });
        if is_glass {
            mat["alphaMode"] = json!("BLEND");
            mat["doubleSided"] = json!(true);
        } else if shader.contains("cutout") || shader.contains("decal") || shader.contains("badges") || bucket == 3 {
            mat["alphaMode"] = json!("MASK");
            mat["alphaCutoff"] = json!(0.5);
            mat["doubleSided"] = json!(true);
        }
        self.materials.push(mat);
        let idx = self.materials.len() - 1;
        self.material_cache.insert(key, idx);
        idx
    }

    fn write(self, root_children: Vec<usize>, extras: Value) -> Vec<u8> {
        let scene_root = json!({
            "name": "vehicle",
            // RAGE Z-up (Y avant) → glTF Y-up : (x, y, z) → (x, z, -y).
            "matrix": [1.0, 0.0, 0.0, 0.0,  0.0, 0.0, -1.0, 0.0,  0.0, 1.0, 0.0, 0.0,  0.0, 0.0, 0.0, 1.0],
            "children": root_children,
        });
        let mut nodes = self.nodes;
        nodes.push(scene_root);
        let root_index = nodes.len() - 1;
        let doc = json!({
            "asset": { "version": "2.0", "generator": "yft2gltf (rage-formats)", "extras": extras },
            "scene": 0,
            "scenes": [{ "nodes": [root_index] }],
            "nodes": nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "accessors": self.accessors,
            "bufferViews": self.buffer_views,
            "buffers": [{ "byteLength": self.bin.len() }],
            "images": self.images,
            "textures": self.textures,
            "samplers": [{ "magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497 }],
        });
        let mut json_bytes = serde_json::to_vec(&doc).unwrap();
        while json_bytes.len() % 4 != 0 {
            json_bytes.push(b' ');
        }
        let mut bin = self.bin;
        while bin.len() % 4 != 0 {
            bin.push(0);
        }
        let total = 12 + 8 + json_bytes.len() + 8 + bin.len();
        let mut out = Vec::with_capacity(total);
        out.extend_from_slice(b"glTF");
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&(total as u32).to_le_bytes());
        out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(b"JSON");
        out.extend_from_slice(&json_bytes);
        out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        out.extend_from_slice(b"BIN\0");
        out.extend_from_slice(&bin);
        out
    }
}

// ─── Export ──────────────────────────────────────────────────────────────────

struct Ctx<'a> {
    glb: Glb,
    textures: &'a HashMap<String, YtdTexture>,
    shaders: HashMap<u32, &'static str>,
    max_size: u32,
    stats: BTreeMap<String, (usize, usize)>,
}

struct SubMesh {
    pos: Vec<f32>,
    nor: Vec<f32>,
    uv: Vec<f32>,
    idx: Vec<u32>,
    remap: HashMap<u32, u32>,
}

impl SubMesh {
    fn new() -> Self {
        SubMesh { pos: Vec::new(), nor: Vec::new(), uv: Vec::new(), idx: Vec::new(), remap: HashMap::new() }
    }
}

fn material_for(ctx: &mut Ctx, drawable: &Drawable, shader_id: u16) -> usize {
    let shader = drawable.shader(shader_id);
    let shader_name = shader
        .and_then(|s| ctx.shaders.get(&s.file_name_hash).or_else(|| ctx.shaders.get(&s.name_hash)).copied())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("shader_{:08x}", shader.map(|s| s.file_name_hash).unwrap_or(0)));
    let bucket = shader.map(|s| s.render_bucket).unwrap_or(0);
    let diffuse = drawable.diffuse_texture_name(shader_id).map(str::to_owned);
    ctx.glb.material(&shader_name, diffuse.as_deref(), bucket, ctx.textures, ctx.max_size)
}

fn push_primitive(ctx: &mut Ctx, sm: &SubMesh, material: usize) -> Value {
    let p = ctx.glb.push_f32_accessor(&sm.pos, 3, "VEC3", true);
    let n = ctx.glb.push_f32_accessor(&sm.nor, 3, "VEC3", false);
    let t = ctx.glb.push_f32_accessor(&sm.uv, 2, "VEC2", false);
    let i = ctx.glb.push_index_accessor(&sm.idx);
    json!({ "attributes": { "POSITION": p, "NORMAL": n, "TEXCOORD_0": t }, "indices": i, "material": material, "mode": 4 })
}

fn safe_normal(n: Vec3) -> Vec3 {
    let n = n.normalize();
    if n.length() > 0.5 { n } else { Vec3::new(0.0, 0.0, 1.0) }
}

/// Maillage skinné : chaque triangle est rattaché à l'os dominant de son
/// premier sommet, et ses sommets sont exprimés dans le repère de cet os.
/// Retourne, par index d'os, la liste des primitives.
fn export_skinned(ctx: &mut Ctx, drawable: &Drawable, worlds: &[(Vec4, Vec3)]) -> BTreeMap<usize, Vec<Value>> {
    let mut out: BTreeMap<usize, Vec<Value>> = BTreeMap::new();
    let Some(lod) = drawable.best_lod() else { return out };
    for model in &lod.models {
        for geom in &model.geometries {
            let (Some(vb), Some(ib)) = (&geom.vertex_buffer, &geom.index_buffer) else { continue };
            let verts = match vb.to_unified_vertices() {
                Ok(v) => v,
                Err(e) => { eprintln!("  sommets illisibles ({e})"); continue; }
            };
            if verts.is_empty() { continue; }
            // Les index/poids de blend sont lus en brut : la crate ne les
            // décode que pour le type UByte4, pas pour le type Colour.
            let stride = vb.vertex_stride as usize;
            let find = |sem: VertexSemantic| vb.declaration.as_ref().and_then(|d| d.components.iter().find(|c| c.semantic == sem)).map(|c| c.offset as usize);
            let (idx_off, w_off) = (find(VertexSemantic::BlendIndices), find(VertexSemantic::BlendWeights));
            let dominant = |i: usize| -> usize {
                let Some(io) = idx_off else { return 0 };
                let base = i * stride;
                let idx = &vb.data[base + io..base + io + 4];
                let best = match w_off {
                    Some(wo) => {
                        let w = &vb.data[base + wo..base + wo + 4];
                        (0..4).max_by_key(|&k| w[k]).unwrap_or(0)
                    }
                    None => 0,
                };
                idx[best] as usize
            };
            let mut subs: BTreeMap<usize, SubMesh> = BTreeMap::new();
            for tri in ib.indices.chunks(3) {
                if tri.len() < 3 || tri.iter().any(|&i| i as usize >= verts.len()) { continue; }
                let bone = dominant(tri[0] as usize);
                let bone = if bone < worlds.len() { bone } else { 0 };
                let (q, t) = worlds.get(bone).copied().unwrap_or((Vec4::new(0.0, 0.0, 0.0, 1.0), Vec3::ZERO));
                let inv = quat_conj(q);
                let sm = subs.entry(bone).or_insert_with(SubMesh::new);
                for &i in tri {
                    let new = if let Some(&n) = sm.remap.get(&i) { n } else {
                        let v = &verts[i as usize];
                        let rel = Vec3::new(v.position.x - t.x, v.position.y - t.y, v.position.z - t.z);
                        let p = inv.quat_rotate(rel);
                        let n = inv.quat_rotate(safe_normal(v.normal));
                        sm.pos.extend_from_slice(&[p.x, p.y, p.z]);
                        sm.nor.extend_from_slice(&[n.x, n.y, n.z]);
                        sm.uv.extend_from_slice(&[v.texcoord0.x, v.texcoord0.y]);
                        let n = (sm.pos.len() / 3 - 1) as u32;
                        sm.remap.insert(i, n);
                        n
                    };
                    sm.idx.push(new);
                }
            }
            let material = material_for(ctx, drawable, geom.shader_id);
            for (bone, sm) in subs {
                if sm.idx.is_empty() { continue; }
                let s = ctx.stats.entry(format!("bone {bone}")).or_insert((0, 0));
                s.0 += sm.pos.len() / 3;
                s.1 += sm.idx.len() / 3;
                let prim = push_primitive(ctx, &sm, material);
                out.entry(bone).or_default().push(prim);
            }
        }
    }
    out
}

/// Maillage rigide (roues…) : un seul nœud, sommets tels quels.
fn export_rigid(ctx: &mut Ctx, drawable: &Drawable, name: &str, matrix: Mat4) -> Option<usize> {
    let lod = drawable.best_lod()?;
    let mut prims = Vec::new();
    for model in &lod.models {
        for geom in &model.geometries {
            let (Some(vb), Some(ib)) = (&geom.vertex_buffer, &geom.index_buffer) else { continue };
            let Ok(verts) = vb.to_unified_vertices() else { continue };
            if verts.is_empty() { continue; }
            let mut sm = SubMesh::new();
            for v in &verts {
                let n = safe_normal(v.normal);
                sm.pos.extend_from_slice(&[v.position.x, v.position.y, v.position.z]);
                sm.nor.extend_from_slice(&[n.x, n.y, n.z]);
                sm.uv.extend_from_slice(&[v.texcoord0.x, v.texcoord0.y]);
            }
            sm.idx = ib.indices.iter().copied().filter(|&i| (i as usize) < verts.len()).collect();
            sm.idx.truncate(sm.idx.len() / 3 * 3);
            if sm.idx.is_empty() { continue; }
            let s = ctx.stats.entry(name.to_owned()).or_insert((0, 0));
            s.0 += verts.len();
            s.1 += sm.idx.len() / 3;
            let material = material_for(ctx, drawable, geom.shader_id);
            prims.push(push_primitive(ctx, &sm, material));
        }
    }
    if prims.is_empty() { return None; }
    ctx.glb.meshes.push(json!({ "name": name, "primitives": prims }));
    let mesh = ctx.glb.meshes.len() - 1;
    let m = &matrix.0;
    let off_diag = [m[1], m[2], m[4], m[6], m[8], m[9]].iter().all(|v| v.abs() < 1e-6);
    let node = if off_diag {
        // Matrice diagonale (roues en miroir) : TRS explicite, plus propre pour les validateurs.
        json!({ "name": name, "mesh": mesh, "translation": [m[12], m[13], m[14]], "scale": [m[0], m[5], m[10]] })
    } else {
        json!({ "name": name, "mesh": mesh, "matrix": m })
    };
    ctx.glb.nodes.push(node);
    Some(ctx.glb.nodes.len() - 1)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: yft2gltf <in.yft> <out.glb> [textures.ytd] [max_texture_size]");
        std::process::exit(2);
    }
    let yft_path = &args[1];
    let out_path = &args[2];
    let ytd_path = args.get(3);
    let max_size: u32 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(1024);

    let yft_bytes = std::fs::read(yft_path).with_context(|| format!("lecture de {yft_path}"))?;
    let fragment = parse_yft(&yft_bytes).context("analyse du YFT")?;
    let system = prepare_rsc7_system(&yft_bytes)?;
    let bones = read_bones(&system).unwrap_or_else(|e| {
        eprintln!("squelette illisible : {e}");
        Vec::new()
    });
    let worlds = bone_world_transforms(&bones);

    // Textures : .ytd externe puis textures embarquées dans les shader groups.
    let mut textures: HashMap<String, YtdTexture> = HashMap::new();
    if let Some(p) = ytd_path {
        let bytes = std::fs::read(p).with_context(|| format!("lecture de {p}"))?;
        for t in parse_ytd(&bytes).context("analyse du YTD")? {
            textures.insert(t.name.to_ascii_lowercase(), t);
        }
    }
    let mut all_drawables: Vec<&Drawable> = fragment.drawable.iter().collect();
    all_drawables.extend(fragment.children.iter().filter_map(|c| c.drawable.as_ref()));
    all_drawables.extend(fragment.extra_drawables.iter().map(|e| &e.drawable));
    for d in &all_drawables {
        if let Some(sg) = &d.shader_group {
            for t in &sg.textures {
                textures.entry(t.name.to_ascii_lowercase()).or_insert_with(|| t.clone());
            }
        }
    }

    println!("fragment « {} » : {} os, {} enfants physiques, {} textures", fragment.name, bones.len(), fragment.children.len(), textures.len());
    for (b, (q, t)) in bones.iter().zip(&worlds) {
        println!("  os {:3} parent {:3} {:18} monde t=({:.3},{:.3},{:.3}) q=({:.2},{:.2},{:.2},{:.2})", b.index, b.parent, b.name, t.x, t.y, t.z, q.x, q.y, q.z, q.w);
    }

    let tag_to_name: HashMap<u16, String> = bones.iter().map(|b| (b.tag, b.name.clone())).collect();
    let mut ctx = Ctx { glb: Glb::default(), textures: &textures, shaders: shader_table(), max_size, stats: BTreeMap::new() };
    let mut root_children = Vec::new();

    // Drawable principal.
    let mut prims_by_bone: BTreeMap<usize, Vec<Value>> = BTreeMap::new();
    if let Some(main) = &fragment.drawable {
        let skinned = main.best_lod().is_some_and(|lod| lod.models.iter().any(|m| m.is_skinned()));
        if skinned && !bones.is_empty() {
            prims_by_bone = export_skinned(&mut ctx, main, &worlds);
        } else {
            // Modèles rigides liés chacun à un os : la pose par défaut les place.
            if let Some(lod) = main.best_lod() {
                let mut by_bone: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
                for (mi, m) in lod.models.iter().enumerate() {
                    by_bone.entry(m.bone_index()).or_default().push(mi);
                }
                for (bone, _models) in by_bone {
                    let name = bones.get(bone).map(|b| b.name.clone()).unwrap_or_else(|| format!("bone_{bone}"));
                    let m = fragment.bone_transforms.get(bone).copied().unwrap_or_else(Mat4::identity);
                    // Un drawable restreint à ce bone : on filtre via un clone léger des modèles.
                    let mut d = main.clone();
                    for l in &mut d.lods { l.models.retain(|mm| mm.bone_index() == bone); }
                    if let Some(n) = export_rigid(&mut ctx, &d, &name, m) { root_children.push(n); }
                }
            }
        }
    }

    // Hiérarchie du squelette : un nœud par os utile (avec géométrie dans son sous-arbre).
    if !prims_by_bone.is_empty() {
        let n = bones.len();
        let mut useful = vec![false; n];
        for (&b, _) in &prims_by_bone {
            let mut i = b as i64;
            let mut guard = 0;
            while i >= 0 && (i as usize) < n && guard < 128 {
                useful[i as usize] = true;
                i = bones[i as usize].parent as i64;
                guard += 1;
            }
        }
        let mut node_index: HashMap<usize, usize> = HashMap::new();
        for i in 0..n {
            if !useful[i] { continue; }
            let b = &bones[i];
            let q = quat_normalize(b.rotation);
            let mut node = json!({
                "name": b.name,
                "translation": [b.translation.x, b.translation.y, b.translation.z],
                "rotation": [q.x, q.y, q.z, q.w],
                "extras": { "boneIndex": b.index, "boneTag": b.tag },
            });
            if let Some(prims) = prims_by_bone.remove(&i) {
                ctx.glb.meshes.push(json!({ "name": b.name, "primitives": prims }));
                node["mesh"] = json!(ctx.glb.meshes.len() - 1);
            }
            ctx.glb.nodes.push(node);
            node_index.insert(i, ctx.glb.nodes.len() - 1);
        }
        for i in 0..n {
            if !useful[i] { continue; }
            let parent = bones[i].parent;
            let me = node_index[&i];
            if parent >= 0 && useful[parent as usize] {
                let p = node_index[&(parent as usize)];
                let children = ctx.glb.nodes[p].as_object_mut().unwrap().entry("children").or_insert_with(|| json!([]));
                children.as_array_mut().unwrap().push(json!(me));
            } else {
                root_children.push(me);
            }
        }
    }

    // Enfants physiques et roues empruntées (comme le rendu du jeu).
    // La pièce est placée sur la position monde de son os (celle du rendu),
    // pas sur celle de l'enfant physique (collision), qui peut différer de
    // plusieurs centimètres (roues arrière du Touran : 9 cm).
    let mut seen_tags: Vec<u16> = Vec::new();
    for part in fragment.render_parts() {
        let Some(tag) = part.bone_tag else { continue };
        if seen_tags.contains(&tag) { continue; }
        seen_tags.push(tag);
        let base = tag_to_name.get(&tag).cloned().unwrap_or_else(|| format!("tag_{tag}"));
        let name = format!("part_{base}");
        let mut transform = part.transform;
        if let Some((i, _)) = bones.iter().enumerate().find(|(_, b)| b.tag == tag) {
            let (_, t) = worlds[i];
            transform = transform.with_translation(t);
        }
        if let Some(n) = export_rigid(&mut ctx, part.drawable, &name, transform) { root_children.push(n); }
    }

    println!("\nnœuds exportés (sommets / triangles) :");
    for (k, (v, t)) in &ctx.stats {
        let label = k.strip_prefix("bone ").and_then(|i| i.parse::<usize>().ok()).and_then(|i| bones.get(i)).map(|b| b.name.clone()).unwrap_or_else(|| k.clone());
        println!("  {label:32} {v:7} / {t:7}");
    }
    println!("matériaux : {}", ctx.glb.materials.len());
    for m in &ctx.glb.materials {
        println!("  {}", m["name"].as_str().unwrap_or(""));
    }

    let bone_json: Vec<Value> = bones.iter().map(|b| json!({ "name": b.name, "tag": b.tag, "index": b.index, "parent": b.parent })).collect();
    let glb = ctx.glb.write(root_children, json!({ "bones": bone_json, "fragment": fragment.name }));
    std::fs::write(out_path, &glb).with_context(|| format!("écriture de {out_path}"))?;
    println!("\n→ {out_path} ({} Ko)", glb.len() / 1024);
    Ok(())
}
