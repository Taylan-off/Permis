# yft2gltf

Convertit un fragment véhicule GTA V (`.yft`, textures `.ytd`) en glTF binaire,
en conservant la hiérarchie des os (portes, hayon, roues…) pour pouvoir les animer.

```bash
cargo build --release
./target/release/yft2gltf minivan.yft touran.glb minivan.ytd 1024
```

Puis compression (sans fusion de nœuds, qui casserait les portes) :

```bash
npx @gltf-transform/cli webp touran.glb t1.glb --quality 82
npx @gltf-transform/cli meshopt t1.glb touran-c.glb --level high
```

## Ce que fait l'outil

- Lit le squelette directement dans la section système du RSC7 (la crate ne
  l'expose pas) : nom, tag, parent, rotation et translation de chaque os.
- Maillage skinné : chaque triangle est rattaché à l'os dominant de son premier
  sommet (les index de blend sont lus en brut : type `Colour`, non décodé par la
  crate) et ses sommets sont exprimés dans le repère de cet os. Un nœud glTF par
  os, hiérarchisé, avec la translation/rotation locale : le pivot est la charnière.
- Enfants physiques (roues) : nœuds rigides placés par leur transformation ; les
  roues droites sont obtenues par miroir comme dans le jeu.
- Matériaux nommés d'après le shader (`vehicle_paint1`, `vehicle_vehglass`…) avec
  la texture diffuse en PNG ; les métadonnées (`extras.shader`, `extras.diffuse`)
  servent au site pour choisir peinture, vitre, etc.
- Le nœud racine convertit Z-up (RAGE) en Y-up (glTF).

Les tags d'os suivent la formule CodeWalker : `ELF(nom majuscule) % 0xFE8F + 0x170`.
