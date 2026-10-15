# Touran Camper 3D

Configurateur web en 3D d'un **VW Touran aménagé pour dormir**. Le but : concevoir
l'aménagement en discutant, le visualiser dans le vrai véhicule, puis construire.

Le modèle 3D est le vrai Touran (2012) issu d'un mod GTA V, converti en glTF avec
l'outil `tools/yft2gltf` du dépôt. Chaque porte, le hayon et les sièges sont des
pièces séparées, animables.

## Fonctionnalités

- Vue 3D orbitale avec ombres, reflets et choix de la couleur de carrosserie.
- Ouvrants animés : 4 portes et hayon, par bouton ou en cliquant dessus.
- Sièges arrière d'origine affichables ou retirés ; sièges avant avançables.
- Aménagement aux cotes relevées sur le modèle : plateforme de lit en deux
  largeurs (passages de roue), matelas, rallonge sur les sièges avant, module
  cuisine coulissant sortant par le hayon, tiroirs plats accessibles par les
  portes arrière, caisses de rangement.
- Vues prédéfinies, **coupe horizontale réglable** pour voir l'intérieur de dessus,
  carrosserie transparente, tableau des cotes.
- **Décor « Route forestière »** : la scène USDZ fournie (Sketchfab, « Dirt Road Through
  Forest »), convertie avec `tools/usd2gltf.py`, agrandie ×8 et posée pour que la
  voiture soit garée sur la ligne droite de la route (`src/forest.js`). Chargée en
  module séparé après le véhicule.
- Décor de montagne léger et entièrement procédural (`src/environment.js`) : ciel
  atmosphérique, relief par bruit simplex (un seul maillage), prairie texturée,
  touffes d'herbe, sapins et feuillus instanciés, rochers, lac à reflets, étoiles.
- **Heure continue** (lever 6 h, coucher 20 h) avec raccourcis midi / golden hour /
  nuit ; feux, lune et étoiles suivent automatiquement.
- Rendu « façon ray tracing » : reflets du vrai décor sur la carrosserie (capture
  cubique), **ombres en cascade (CSM)** sur toute la forêt (les arbres projettent sur
  la route), feuillages à bords lissés (alpha to coverage), occlusion ambiante GTAO
  en Ultra, bloom, MSAA, tone mapping ACES.
- Feux allumés : phares avec projecteurs modelés et faisceaux visibles, feux
  arrière LED, plaque, tableau de bord. Capot ouvrable (découpé du châssis au
  chargement) sur compartiment moteur simplifié. Jantes aluminium.
- Garniture de toit étoilée (façon Rolls-Royce Starlight), 570 points scintillants.
- **Mode photo** : rendu Full HD / QHD / 4K de la vue actuelle en qualité maximale,
  à l'heure choisie, téléchargeable.
- Trois modes de performance : Éco (sans effets), Standard, Ultra (iPad Pro, PC).

## Lancer le projet

```bash
npm install
npm run dev      # serveur de développement (http://localhost:5173)
npm run build    # génère le site statique dans dist/
npm run build:inline  # idem, modèle 3D intégré dans le JS (hébergement sans .glb)
npm run preview  # prévisualise le build
```

`measure.html` est une page de travail qui charge le véhicule seul et expose
`window.__app` pour mesurer l'habitacle (lancer de rayons) depuis la console.

## Structure

- `src/assets/touran.glb` : le véhicule (glTF compressé meshopt + WebP, 1,7 Mo).
- `src/assets/grass*.jpg` : texture d'herbe (three.js, licence MIT) et sa carte de relief.
- `src/environment.js` : ciel, montagnes, prairie, sapins.
- `src/vehicle.js` : chargement du modèle, matériaux, séparation des sièges, ouvrants.
- `src/interior.js` : aménagement (cotes dans `LAYOUT`).
- `src/main.js` : scène, caméra, animations, interface.
- `tools/yft2gltf/` : convertisseur Rust `.yft` + `.ytd` (GTA V) → `.glb`.
- `tools/usd2gltf.py` : convertisseur USD/USDZ → `.glb` (maillages, UV, matériaux PBR,
  textures WebP). `src/assets/forest.glb` en est issu. `env.setPanorama(url)` accepte
  aussi une image 360° équirectangulaire à la place du ciel procédural.

## Cotes relevées sur le modèle (repère : X avant, Y haut, Z côté passager)

| Élément | Valeur |
|---|---|
| Longueur / largeur (rétros) / hauteur | 4,47 / 2,08 / 1,69 m |
| Plancher du coffre | 0,475 m du sol |
| Plancher sous la banquette (retirée) | ≈ 0,60 m |
| Face interne du hayon fermé | x = -1,92 m |
| Dossiers des sièges avant (reculés) | x = -0,25 m |
| Largeur entre passages de roue | 0,98 m (jusqu'à ≈ 0,80 m de haut), 1,30 m au-dessus |
| Plafond | 1,47 m (arrière) à 1,60 m (milieu) |

## Crédits

Modèle : mod GTA V « Volkswagen Touran 2012 » par SizzGamesMods (conversion Iddo),
utilisé ici uniquement pour un projet personnel de visualisation. Lecture du
format RAGE par la crate Rust [`rage-formats`](https://crates.io/crates/rage-formats).
