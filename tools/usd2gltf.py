#!/usr/bin/env python3
"""Convertit une scène USD/USDZ (maillages + matériaux PBR texturés) en glTF binaire.

Usage : python3 tools/usd2gltf.py scene.usdz sortie.glb [taille_max_textures]

- Transformations monde et unités (metersPerUnit) intégrées aux sommets, Y vers le haut.
- Polygones triangulés en éventail, UV « st » faceVarying ou par sommet, normales
  lues ou recalculées, sommets dédoublonnés.
- Matériaux UsdPreviewSurface : couleur de base (alpha → découpe), normale,
  rugosité (convertie en texture metallicRoughness glTF). Textures redimensionnées.
Dépendances : usd-core, numpy, Pillow.
"""
import io
import json
import os
import struct
import sys
import zipfile

import numpy as np
from PIL import Image
from pxr import Gf, Usd, UsdGeom, UsdShade


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    src, out = sys.argv[1], sys.argv[2]
    max_tex = int(sys.argv[3]) if len(sys.argv) > 3 else 1024

    stage = Usd.Stage.Open(src)
    scale = UsdGeom.GetStageMetersPerUnit(stage) or 1.0
    up = UsdGeom.GetStageUpAxis(stage)
    zf = zipfile.ZipFile(src) if src.lower().endswith('.usdz') else None

    bin_parts = []
    bin_len = 0
    buffer_views, accessors, meshes, nodes, materials, images, textures = [], [], [], [], [], [], []
    material_index = {}
    image_index = {}

    def push_view(data: bytes, target=None):
        nonlocal bin_len
        pad = (-bin_len) % 4
        if pad:
            bin_parts.append(b'\0' * pad)
            bin_len += pad
        view = {'buffer': 0, 'byteOffset': bin_len, 'byteLength': len(data)}
        if target:
            view['target'] = target
        buffer_views.append(view)
        bin_parts.append(data)
        bin_len += len(data)
        return len(buffer_views) - 1

    def push_accessor(arr, ctype, atype, target, bounds=False):
        view = push_view(arr.tobytes(), target)
        acc = {'bufferView': view, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': atype}
        if bounds:
            acc['min'] = [float(v) for v in arr.min(axis=0)]
            acc['max'] = [float(v) for v in arr.max(axis=0)]
        accessors.append(acc)
        return len(accessors) - 1

    def read_texture(path):
        if zf is not None:
            try:
                return Image.open(io.BytesIO(zf.read(path)))
            except KeyError:
                return None
        p = os.path.join(os.path.dirname(src), path)
        return Image.open(p) if os.path.exists(p) else None

    def add_image(key, img, fmt='webp'):
        if key in image_index:
            return image_index[key]
        if max(img.size) > max_tex:
            r = max_tex / max(img.size)
            img = img.resize((max(1, int(img.width * r)), max(1, int(img.height * r))), Image.LANCZOS)
        buf = io.BytesIO()
        if fmt == 'webp':
            img.save(buf, 'WEBP', quality=82, method=4)
            mime = 'image/webp'
        else:
            img.save(buf, 'PNG', optimize=True)
            mime = 'image/png'
        view = push_view(buf.getvalue())
        images.append({'name': key, 'mimeType': mime, 'bufferView': view})
        textures.append({'sampler': 0, 'source': len(images) - 1})
        image_index[key] = len(textures) - 1
        return image_index[key]

    def texture_inputs(material):
        """Retourne {canal: chemin} pour les UsdUVTexture connectés au surface."""
        found = {}
        for prim in Usd.PrimRange(material.GetPrim()):
            if not prim.IsA(UsdShade.Shader):
                continue
            sh = UsdShade.Shader(prim)
            if sh.GetIdAttr().Get() != 'UsdUVTexture':
                continue
            f = sh.GetInput('file').Get()
            if not f:
                continue
            name = prim.GetName().lower()
            for key in ('base', 'diffuse', 'normal', 'rough', 'metal', 'emissive', 'opacity'):
                if key in name:
                    found[key] = f.path
                    break
        return found

    def material_for(prim, double_sided):
        binding = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
        key = (binding.GetPath().pathString if binding else '__default__', double_sided)
        if key in material_index:
            return material_index[key]
        mat = {'name': key[0].split('/')[-1], 'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 1.0}, 'doubleSided': double_sided}
        if binding:
            tex = texture_inputs(binding)
            base = tex.get('base') or tex.get('diffuse')
            if base:
                img = read_texture(base)
                if img is not None:
                    has_alpha = img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info)
                    if has_alpha:
                        img = img.convert('RGBA')
                        alpha = np.asarray(img)[..., 3]
                        has_alpha = bool((alpha < 250).any())
                    if has_alpha:
                        mat['alphaMode'] = 'MASK'
                        mat['alphaCutoff'] = 0.5
                        mat['doubleSided'] = True
                        mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': add_image(base, img, 'png')}
                    else:
                        mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': add_image(base, img.convert('RGB'))}
            if tex.get('normal'):
                img = read_texture(tex['normal'])
                if img is not None:
                    mat['normalTexture'] = {'index': add_image(tex['normal'], img.convert('RGB'))}
            if tex.get('rough'):
                img = read_texture(tex['rough'])
                if img is not None:
                    g = img.convert('L')
                    mr = Image.merge('RGB', (Image.new('L', g.size, 255), g, Image.new('L', g.size, 0)))
                    mat['pbrMetallicRoughness']['metallicRoughnessTexture'] = {'index': add_image(tex['rough'] + '#mr', mr)}
            if tex.get('emissive'):
                img = read_texture(tex['emissive'])
                if img is not None:
                    mat['emissiveTexture'] = {'index': add_image(tex['emissive'], img.convert('RGB'))}
                    mat['emissiveFactor'] = [1.0, 1.0, 1.0]
        materials.append(mat)
        material_index[key] = len(materials) - 1
        return material_index[key]

    cache = UsdGeom.XformCache(Usd.TimeCode.Default())
    total_tris = 0
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        pts = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        indices = mesh.GetFaceVertexIndicesAttr().Get()
        if not pts or not counts:
            continue
        m = cache.GetLocalToWorldTransform(prim)
        M = np.array([[m[i][j] for j in range(4)] for i in range(4)], dtype=np.float64)  # ligne-major, p' = p·M
        P = np.asarray(pts, dtype=np.float64)
        Pw = (np.c_[P, np.ones(len(P))] @ M)[:, :3] * scale
        if up == 'Z':
            Pw = Pw[:, [0, 2, 1]] * np.array([1, 1, -1])
        flip = np.linalg.det(M[:3, :3]) < 0
        if mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded:
            flip = not flip

        counts = np.asarray(counts, dtype=np.int64)
        fvi = np.asarray(indices, dtype=np.int64)
        # Index de face-sommet (position dans fvi) pour chaque coin de triangle.
        starts = np.cumsum(np.r_[0, counts[:-1]])
        tri_corners = []
        for s, n in zip(starts, counts):
            for i in range(1, n - 1):
                tri_corners.append((s, s + i, s + i + 1) if not flip else (s, s + i + 1, s + i))
        corners = np.asarray(tri_corners, dtype=np.int64).reshape(-1)  # face-vertex ids
        point_ids = fvi[corners]
        pos = Pw[point_ids].astype(np.float32)

        # Normales.
        normals = mesh.GetNormalsAttr().Get()
        nrm = None
        if normals and len(normals):
            N = np.asarray(normals, dtype=np.float64)
            interp = mesh.GetNormalsInterpolation()
            Nw = N @ np.linalg.inv(M[:3, :3]).T
            if up == 'Z':
                Nw = Nw[:, [0, 2, 1]] * np.array([1, 1, -1])
            if interp == UsdGeom.Tokens.faceVarying and len(N) == len(fvi):
                nrm = Nw[corners]
            elif len(N) == len(P):
                nrm = Nw[point_ids]
        if nrm is None:
            tri = pos.reshape(-1, 3, 3).astype(np.float64)
            fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
            nrm = np.repeat(fn, 3, axis=0)
        nrm = nrm / (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12)
        if flip and normals is not None and len(normals):
            pass
        nrm = nrm.astype(np.float32)

        # UV.
        uv = None
        pv = UsdGeom.PrimvarsAPI(prim).GetPrimvar('st')
        if pv and pv.HasValue():
            vals = np.asarray(pv.Get(), dtype=np.float64)
            idx = pv.GetIndices()
            if idx:
                vals = vals[np.asarray(idx, dtype=np.int64)]
            interp = pv.GetInterpolation()
            if interp == UsdGeom.Tokens.faceVarying and len(vals) == len(fvi):
                uv = vals[corners]
            elif len(vals) == len(P):
                uv = vals[point_ids]
        if uv is None:
            uv = np.zeros((len(pos), 2))
        uv = np.c_[uv[:, 0], 1.0 - uv[:, 1]].astype(np.float32)

        # Dédoublonnage.
        rows = np.c_[pos, nrm, uv]
        _, first, inverse = np.unique(np.round(rows, 5), axis=0, return_index=True, return_inverse=True)
        v_pos, v_nrm, v_uv = pos[first], nrm[first], uv[first]
        index = inverse.reshape(-1).astype(np.uint32)

        double_sided = bool(mesh.GetDoubleSidedAttr().Get())
        mat = material_for(prim, double_sided)
        prim_json = {
            'attributes': {
                'POSITION': push_accessor(v_pos, 5126, 'VEC3', 34962, True),
                'NORMAL': push_accessor(v_nrm, 5126, 'VEC3', 34962),
                'TEXCOORD_0': push_accessor(v_uv, 5126, 'VEC2', 34962),
            },
            'indices': push_accessor(index, 5125, 'SCALAR', 34963),
            'material': mat,
            'mode': 4,
        }
        meshes.append({'name': prim.GetName(), 'primitives': [prim_json]})
        nodes.append({'name': prim.GetName(), 'mesh': len(meshes) - 1})
        total_tris += len(index) // 3
        print(f'{prim.GetName():60} {len(v_pos):7} sommets {len(index) // 3:7} triangles mat={materials[mat]["name"]}')

    root = {'name': 'scene', 'children': list(range(len(nodes)))}
    nodes.append(root)
    doc = {
        'asset': {'version': '2.0', 'generator': 'usd2gltf.py'},
        'scene': 0,
        'scenes': [{'nodes': [len(nodes) - 1]}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': materials,
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': bin_len}],
        'images': images,
        'textures': textures,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'extensionsUsed': ['EXT_texture_webp'],
        'extensionsRequired': ['EXT_texture_webp'],
    }
    # Les textures WebP passent par l'extension ; on réécrit les références.
    for t in textures:
        if images[t['source']]['mimeType'] == 'image/webp':
            t['extensions'] = {'EXT_texture_webp': {'source': t.pop('source')}}
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    binb = b''.join(bin_parts)
    binb += b'\0' * ((-len(binb)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(out, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<I', len(js)) + b'JSON' + js)
        f.write(struct.pack('<I', len(binb)) + b'BIN\0' + binb)
    print(f'→ {out} : {total / 1e6:.1f} Mo, {total_tris} triangles, {len(materials)} matériaux, {len(images)} images')


if __name__ == '__main__':
    main()
