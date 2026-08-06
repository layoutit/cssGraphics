import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

function integerAttribute(node, name, label) {
  const value = Number(node.getAttribute(name));
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value;
}

function sortedTargets(nodes, attribute, label) {
  return [...nodes].sort((left, right) =>
    integerAttribute(left, attribute, label) - integerAttribute(right, attribute, label));
}

function bankedTargets(nodes, attribute, label, bankCount, targetCount) {
  const banks = Array.from({ length: bankCount }, () => []);
  for (const node of nodes) {
    const bank = integerAttribute(node, "data-csspipes-bank-index", "Prepared bank index");
    if (bank < 0 || bank >= bankCount) {
      throw new Error(`Prepared ${label} bank ${bank} is out of range`);
    }
    banks[bank].push(node);
  }
  for (let bank = 0; bank < bankCount; bank += 1) {
    banks[bank] = sortedTargets(banks[bank], attribute, label);
    if (banks[bank].length !== targetCount || !banks[bank].every((node, index) =>
      integerAttribute(node, attribute, label) === index)) {
      throw new Error(`Prepared ${label} bank ${bank} is incomplete`);
    }
  }
  return Object.freeze(banks.map((bank) => Object.freeze(bank)));
}

export function createPreparedDomBanks(options) {
  const { playback, playbackRoot, sceneRoot } = options;
  const shapeRootsByBank = bankedTargets(
    options.shapeRoots,
    "data-csspipes-shape-index",
    "Prepared shape index",
    playback.retainedBankCount,
    playback.retainedRootCount,
  );
  const leafRootsByBank = bankedTargets(
    options.leafRoots,
    "data-csspipes-leaf-index",
    "Prepared leaf index",
    playback.retainedBankCount,
    playback.leafTargetCount,
  );
  const shapeRoots = shapeRootsByBank.flat();
  const leafRoots = leafRootsByBank.flat();
  const shapeVisibility = new Uint8Array(playback.totalRetainedRootCount);
  const leafVisibility = new Uint8Array(playback.totalLeafTargetCount);
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

  function writePlaybackRoot(transforms, transformIndex, opacity) {
    if (transformIndex >= 0) {
      const transform = preparedTransform(transforms, transformIndex);
      if (playbackRoot.style.transform !== transform) {
        playbackRoot.style.transform = transform;
      }
    }
    if (opacity >= 0 && playbackRoot.style.opacity !== String(opacity)) {
      playbackRoot.style.opacity = String(opacity);
    }
  }

  function writePipeMaterial(bank, pipe, clipIndex) {
    const root = shapeRootsByBank[bank][pipe];
    const value = String(clipIndex);
    if (root.getAttribute("data-csspipes-material-clip") === value) return;
    root.setAttribute("data-csspipes-material-clip", value);
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
    writePlaybackRoot,
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
