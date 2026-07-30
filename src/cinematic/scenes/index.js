/* ==========================================================================
   Sahne Kaydı

   Yeni sahne eklemek: dosyayı yaz, buraya kaydet. Başka hiçbir yere dokunma.
   ========================================================================== */

import introScene from './intro.js';
import outroAskScene from './outro-ask.js';
import outroYesScene from './outro-yes.js';
import outroNoScene from './outro-no.js';

export const SCENES = {
  'intro':     introScene,
  'outro-ask': outroAskScene,
  'outro-yes': outroYesScene,
  'outro-no':  outroNoScene
};

export const SCENE_IDS = Object.keys(SCENES);

export function getScene(id) {
  return SCENES[id] || null;
}

/** Seçim sonrası hangi sahneye gidilir */
export function sceneAfterChoice(choiceId) {
  return choiceId === 'yes' ? 'outro-yes' : 'outro-no';
}
