// SPDX-License-Identifier: HPND

const STORAGE_KEY = "cssgalaxy:prepared-encounter-shuffle@1";
const STORAGE_SCHEMA = "cssgalaxy-prepared-encounter-shuffle@1";

export function selectGalaxyStartupEncounter(catalog, options = {}) {
  const encounterOrder = catalog?.seeds?.[String(catalog.comparisonSeed)]?.encounterOrder;
  const seeds = [...(catalog?.curatedEncounterSeeds ?? [])];
  if (!Array.isArray(encounterOrder) || seeds.length !== catalog?.encounterReel?.encounterCount ||
      new Set(seeds).size !== seeds.length || encounterOrder.length !== seeds.length ||
      encounterOrder.some((seed, index) => seed !== seeds[index])) {
    throw new Error("Galaxy startup encounter bank drifted");
  }
  const signature = seeds.join("\n");
  const storage = options.storage ?? safeSessionStorage();
  const randomUint32 = options.randomUint32 ?? cryptoRandomUint32;
  const restored = readState(storage, signature, seeds);
  let remaining = restored?.remainingSeeds ?? [];
  const lastSeed = restored?.lastSeed ?? null;
  let randomUint32Count = 0;

  if (remaining.length === 0) {
    remaining = [...seeds];
    for (let index = remaining.length - 1; index > 0; index -= 1) {
      const value = randomUint32();
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new RangeError("Galaxy startup shuffle value must be uint32");
      }
      const swapIndex = value % (index + 1);
      [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
      randomUint32Count += 1;
    }
    if (lastSeed !== null && remaining.at(-1) === lastSeed) {
      [remaining[0], remaining[remaining.length - 1]] =
        [remaining[remaining.length - 1], remaining[0]];
    }
  }

  const sourceSeed = remaining.pop();
  if (!Number.isSafeInteger(sourceSeed) || sourceSeed === lastSeed) {
    throw new Error("Galaxy startup shuffle repeated its previous encounter");
  }
  const encounterIndex = encounterOrder.indexOf(sourceSeed);
  const initialStreamFrame = encounterIndex * catalog.encounterReel.encounterFrameCount;
  writeState(storage, {
    schema: STORAGE_SCHEMA,
    bankSignature: signature,
    lastSeed: sourceSeed,
    remainingSeeds: remaining,
  });
  return Object.freeze({
    sourceSeed,
    encounterIndex,
    initialStreamFrame,
    initialBlockIndex: Math.floor(initialStreamFrame / catalog.blockFrameCount),
    initialBankIndex: Math.floor(initialStreamFrame / catalog.bankFrameCount),
    mode: "session-shuffled-qualified-encounter-start-without-replacement",
    remainingEncounterCount: remaining.length,
    randomUint32Count,
    sessionPersistence: Boolean(storage),
  });
}

function readState(storage, signature, seeds) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    const remaining = value?.remainingSeeds;
    const allowed = new Set(seeds);
    if (value?.schema !== STORAGE_SCHEMA || value.bankSignature !== signature ||
        (value.lastSeed !== null && !allowed.has(value.lastSeed)) ||
        !Array.isArray(remaining) || new Set(remaining).size !== remaining.length ||
        remaining.some((seed) => !allowed.has(seed) || seed === value.lastSeed)) {
      return null;
    }
    return Object.freeze({ lastSeed: value.lastSeed, remainingSeeds: [...remaining] });
  } catch {
    return null;
  }
}

function writeState(storage, value) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Startup still uses a fresh cryptographic shuffle when storage is unavailable.
  }
}

function safeSessionStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}
