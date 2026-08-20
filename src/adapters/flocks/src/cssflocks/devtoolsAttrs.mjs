export function attachFlocksSceneMetadata(element, { sceneId, profileId }) {
  element.dataset.cssflocksScene = sceneId;
  element.dataset.cssflocksProfile = profileId;
}
