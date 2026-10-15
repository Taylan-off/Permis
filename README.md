# Touran Camper 3D

Configurateur web en 3D d'un **VW Touran aménagé pour dormir**. Le véhicule est
modélisé directement en code (Three.js), ce qui permet d'ouvrir chaque porte, le
hayon, de sortir le module cuisine et d'afficher ou masquer les éléments de
l'aménagement.

## Fonctionnalités

- Vue 3D orbitale (rotation, zoom, déplacement) avec ombres et reflets.
- Ouvrants animés : 4 portes et hayon, par bouton ou en cliquant dessus dans la 3D.
- Aménagement : plateforme de lit (2,00 × 1,50 m), matelas, module cuisine
  coulissant sortant par le hayon (réchaud, jerrican, rangement), caisses de
  rangement sous le lit. Option pour remettre les sièges arrière d'origine.
- Vues prédéfinies (3/4 avant, 3/4 arrière, profil, dessus, intérieur couchage),
  carrosserie transparente, toit masquable, choix de la couleur.

## Lancer le projet

```bash
npm install
npm run dev      # serveur de développement
npm run build    # génère le site statique dans dist/
npm run preview  # prévisualise le build
```

## Structure

- `src/van.js` : carrosserie, portes, hayon, roues (cotes du Touran II).
- `src/interior.js` : sièges, lit, cuisine, rangements.
- `src/main.js` : scène, caméra, animations, interface.
- `src/materials.js`, `src/geometry.js` : matériaux et helpers de géométrie.
