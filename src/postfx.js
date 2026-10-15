import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/*
 * Chaîne de post-traitement « façon ray tracing » :
 *  - rendu HDR anticrénelé (MSAA 4x, demi-flottants) ;
 *  - occlusion ambiante GTAO (contacts, creux, dessous de caisse) ;
 *  - bloom réservé aux sources très lumineuses (phares, feux, soleil) ;
 *  - tone mapping ACES et conversion sRGB en sortie.
 */
export function createPostFX(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.updateGtaoMaterial({
    radius: 0.5,
    distanceExponent: 1,
    thickness: 1,
    scale: 1.1,
    samples: 12,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  gtao.blendIntensity = 0.9;
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.6, 1.7);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  return {
    composer,
    gtao,
    bloom,
    setSize(w, h) {
      composer.setSize(w, h);
      gtao.setSize(w, h);
      bloom.setSize(w, h);
    },
    setQuality(high) {
      gtao.enabled = high;
      bloom.enabled = high;
    },
    render() {
      composer.render();
    },
  };
}
