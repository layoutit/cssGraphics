import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

function orderedBanks(nodes, label, bankCount, targetCount) {
  const targets = [...nodes];
  if (targets.length !== bankCount * targetCount) {
    throw new Error(`Prepared ${label} targets are incomplete`);
  }
  return Object.freeze(Array.from({ length: bankCount }, (_, bank) =>
    Object.freeze(targets.slice(bank * targetCount, (bank + 1) * targetCount))));
}

export function createPreparedDomBanks(options) {
  const { playback, sceneRoot } = options;
  const shapeRootsByBank = orderedBanks(
    options.shapeRoots,
    "shape",
    playback.retainedBankCount,
    playback.retainedRootCount,
  );
  const leafRootsByBank = orderedBanks(
    options.leafRoots,
    "leaf",
    playback.retainedBankCount,
    playback.leafTargetCount,
  );
  const shapeRoots = shapeRootsByBank.flat();
  const leafRoots = leafRootsByBank.flat();
  const shapeVisibility = new Uint8Array(playback.totalRetainedRootCount);
  const leafVisibility = new Uint8Array(playback.totalLeafTargetCount);
  const pipeMaterials = new Int16Array(playback.totalRetainedRootCount).fill(-1);
  const initialMaterials = playback.clips[0]?.materialIndicesByPipe;
  if (!Array.isArray(initialMaterials) || initialMaterials.length !== playback.pipeCount) {
    throw new Error("Prepared initial materials are incomplete");
  }
  for (let bank = 0; bank < playback.retainedBankCount; bank += 1) {
    for (let pipe = 0; pipe < playback.pipeCount; pipe += 1) {
      const targetIndex = bank * playback.retainedRootCount + pipe;
      const materialIndex = initialMaterials[pipe];
      if (!shapeRoots[targetIndex]?.classList.contains(`m${materialIndex}`)) {
        throw new Error(`Prepared initial material ${bank}:${pipe} is missing`);
      }
      pipeMaterials[targetIndex] = materialIndex;
    }
  }
  const morphTarget = createPolyMorphPreparedDomTarget({
    model: {
      element: sceneRoot,
      writeTransform(transform) {
        if (sceneRoot.style.transform === transform) return false;
        sceneRoot.style.transform = transform;
        return true;
      },
    },
    shapes: shapeRoots.map((element) => ({ element })),
    leaves: leafRoots.map((element) => ({ element })),
  });

  function preparedTransform(transforms, index) {
    const transform = transforms[index];
    if (typeof transform !== "string") {
      throw new Error(`Prepared transform ${index} is missing`);
    }
    return transform;
  }

  function writeShape(transforms, bank, index, transformIndex, visible) {
    const targetIndex = bank * playback.retainedRootCount + index;
    const target = morphTarget.shapes[targetIndex];
    const root = shapeRoots[targetIndex];
    const valid = [
      target,
      root,
      Number.isInteger(transformIndex),
      visible === 0 || visible === 1,
    ].every(Boolean);
    if (!valid) throw new Error(`Prepared shape assignment ${index} is invalid`);
    target.writeTransform(preparedTransform(transforms, transformIndex));
    const nextVisible = visible === 1;
    target.writeVisibility(nextVisible);
    target.writeOpacity(nextVisible ? 1 : 0);
    shapeVisibility[targetIndex] = visible;
  }

  function writeLeaf(transforms, bank, index, transformIndex, visible) {
    const targetIndex = bank * playback.leafTargetCount + index;
    const target = morphTarget.leaves[targetIndex];
    const root = leafRoots[targetIndex];
    if (!target || !root || (visible !== 0 && visible !== 1)) {
      throw new Error(`Prepared leaf assignment ${index} is invalid`);
    }
    target.writeTransform(preparedTransform(transforms, transformIndex));
    const nextVisible = visible === 1;
    target.writeVisibility(nextVisible);
    leafVisibility[targetIndex] = visible;
  }

  function hideBank(bank) {
    for (let index = 0; index < playback.retainedRootCount; index += 1) {
      const targetIndex = bank * playback.retainedRootCount + index;
      if (shapeVisibility[targetIndex] === 0) continue;
      const target = morphTarget.shapes[targetIndex];
      target.writeVisibility(false);
      target.writeOpacity(0);
      shapeVisibility[targetIndex] = 0;
    }
    for (let index = 0; index < playback.leafTargetCount; index += 1) {
      const targetIndex = bank * playback.leafTargetCount + index;
      if (leafVisibility[targetIndex] === 0) continue;
      const target = morphTarget.leaves[targetIndex];
      target.writeVisibility(false);
      leafVisibility[targetIndex] = 0;
    }
  }

  function writePipeMaterial(bank, pipe, clipIndex) {
    const root = shapeRootsByBank[bank][pipe];
    const targetIndex = bank * playback.retainedRootCount + pipe;
    const materialIndex = playback.clips[clipIndex]?.materialIndicesByPipe?.[pipe];
    if (!root || !Number.isInteger(materialIndex)) {
      throw new Error(`Prepared material assignment ${clipIndex}:${pipe} is invalid`);
    }
    const previous = pipeMaterials[targetIndex];
    if (previous === materialIndex) return;
    if (previous >= 0) root.classList.remove(`m${previous}`);
    root.classList.add(`m${materialIndex}`);
    pipeMaterials[targetIndex] = materialIndex;
  }

  return Object.freeze({
    preparedTransform,
    writeModelTransform(transforms, transformIndex) {
      morphTarget.model.writeTransform(preparedTransform(transforms, transformIndex));
    },
    writeShape,
    writeLeaf,
    hideBank,
    hideAllBanks() {
      for (let bank = 0; bank < playback.retainedBankCount; bank += 1) hideBank(bank);
    },
    writePipeMaterial,
    writeBankMaterial(bank, clipIndex) {
      for (let pipe = 0; pipe < playback.pipeCount; pipe += 1) {
        writePipeMaterial(bank, pipe, clipIndex);
      }
    },
    assertStableDomIdentity() {
      morphTarget.assertStableDomIdentity();
    },
    destroy() {
      morphTarget.destroy();
    },
  });
}
