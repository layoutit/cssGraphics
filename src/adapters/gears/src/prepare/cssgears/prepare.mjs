import {
  buildCssgearsFirstSliceScene,
} from "./sceneBuilder.mjs";
import {
  resolveCssgearsDataSource,
} from "./dataSource.mjs";
import {
  captureNativeGears,
  CSSGEARS_NATIVE_SEED,
} from "./nativeOracle.mjs";
import {
  writeCssgearsPreparedOutput,
} from "./writeManifest.mjs";

export const CSSGEARS_PREPARED_BANK = Object.freeze([
  Object.freeze({ id: "fixed-non-planetary", seed: 26080601 }),
  Object.freeze({ id: "seed-26080608", seed: 26080608 }),
  Object.freeze({ id: "seed-26080609", seed: 26080609 }),
  Object.freeze({ id: "seed-26080702", seed: 26080702 }),
  Object.freeze({ id: "seed-26080617", seed: 26080617 }),
  Object.freeze({ id: "seed-26080618", seed: 26080618 }),
  Object.freeze({ id: "seed-26080621", seed: 26080621 }),
  Object.freeze({ id: "seed-26080634", seed: 26080634 }),
  Object.freeze({ id: "seed-26080641", seed: 26080641 }),
  Object.freeze({ id: "seed-26080729", seed: 26080729 }),
  Object.freeze({ id: "seed-26080644", seed: 26080644 }),
  Object.freeze({ id: "seed-26080652", seed: 26080652 }),
  Object.freeze({ id: "seed-26080653", seed: 26080653 }),
  Object.freeze({ id: "seed-26080654", seed: 26080654 }),
  Object.freeze({ id: "seed-26080655", seed: 26080655 }),
  Object.freeze({ id: "seed-26080666", seed: 26080666 }),
  Object.freeze({ id: "seed-26080671", seed: 26080671 }),
  Object.freeze({ id: "seed-26080739", seed: 26080739 }),
  Object.freeze({ id: "seed-26080678", seed: 26080678 }),
  Object.freeze({ id: "seed-26080682", seed: 26080682 }),
  Object.freeze({ id: "seed-26080683", seed: 26080683 }),
  Object.freeze({ id: "seed-26080685", seed: 26080685 }),
  Object.freeze({ id: "seed-26080690", seed: 26080690 }),
  Object.freeze({ id: "seed-26080776", seed: 26080776 }),
]);

export async function prepareCssgears(options = {}) {
  const dataSource = await resolveCssgearsDataSource({
    sourceRoot: options.sourceRoot,
  });
  const entries = selectedBankEntries(options);
  const scenes = [];
  for (const entry of entries) {
    const nativeCapture = await captureNativeGears(dataSource.root, { seed: entry.seed });
    if (nativeCapture.state.gearCount !== 3) {
      throw new Error(`Prepared cssGears bank seed ${entry.seed} produced ${nativeCapture.state.gearCount} gears instead of three`);
    }
    scenes.push(await buildCssgearsFirstSliceScene({
      dataSource,
      nativeCapture,
      sceneId: entry.id,
    }));
  }
  return writeCssgearsPreparedOutput({
    scenes,
    defaultSceneId: scenes[0].id,
    preparedBank: Object.freeze({
      schema: "cssgears-prepared-bank@2",
      selection: "crypto-random-shuffled-bag-no-immediate-repeat",
      sceneIds: Object.freeze(scenes.map((scene) => scene.id)),
      seeds: Object.freeze(scenes.map((scene) => scene.sourceProfile.seed)),
      runtimeSceneGeneration: false,
      runtimeGeometryConstruction: false,
      mountedSceneCount: 1,
      retainedSceneBankCount: scenes.length,
    }),
  });
}

function selectedBankEntries(options) {
  if (options.seeds !== undefined) {
    const values = String(options.seeds).split(",").map((value) => Number(value.trim()));
    if (values.length === 0 || values.some((seed) => !Number.isSafeInteger(seed) || seed <= 0) ||
        new Set(values).size !== values.length) {
      throw new RangeError("cssGears candidate seeds must be unique positive integers");
    }
    return values.map((seed) => Object.freeze({
      id: seed === CSSGEARS_NATIVE_SEED ? "fixed-non-planetary" : `seed-${seed}`,
      seed,
    }));
  }
  if (options.seed !== undefined) {
    const seed = Number(options.seed);
    if (!Number.isSafeInteger(seed) || seed <= 0) throw new RangeError("cssGears seed must be a positive integer");
    return [Object.freeze({ id: options.scene ?? `seed-${seed}`, seed })];
  }
  if (options.scene) {
    const entry = CSSGEARS_PREPARED_BANK.find((candidate) => candidate.id === options.scene);
    if (!entry) throw new RangeError(`Unknown prepared cssGears bank scene ${options.scene}`);
    return [entry];
  }
  return CSSGEARS_PREPARED_BANK;
}
