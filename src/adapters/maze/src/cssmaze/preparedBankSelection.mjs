const STORAGE_KEY = "cssmaze:prepared-scene-shuffle@1";
const STORAGE_SCHEMA = "cssmaze-prepared-scene-shuffle@1";

export function createPreparedSceneShuffledBag(manifest, options = {}) {
  const ids = [...(manifest?.preparedBank?.sceneIds ?? [])];
  const scenesById = new Map((manifest?.scenes ?? []).map((scene) => [scene.id, scene]));
  if (ids.length < 2 || new Set(ids).size !== ids.length ||
      ids.some((id) => !scenesById.has(id))) {
    throw new Error("cssMaze shuffled bank requires distinct prepared scenes");
  }
  const signature = ids.join("\n");
  const storage = options.storage ?? safeSessionStorage();
  const randomUint32 = options.randomUint32 ?? cryptoRandomUint32;
  const restored = readState(storage, signature, ids);
  let remaining = restored?.remainingSceneIds ?? [];
  let lastSceneId = restored?.lastSceneId ?? null;
  let randomUint32Count = 0;
  let refillCount = 0;

  function refill() {
    remaining = [...ids];
    for (let index = remaining.length - 1; index > 0; index -= 1) {
      const value = randomUint32();
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError("cssMaze shuffled-bank random value must be uint32");
      }
      const swapIndex = value % (index + 1);
      [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
      randomUint32Count += 1;
    }
    if (lastSceneId && remaining.at(-1) === lastSceneId) {
      [remaining[0], remaining[remaining.length - 1]] =
        [remaining[remaining.length - 1], remaining[0]];
    }
    refillCount += 1;
    persist();
  }

  function peekEntry() {
    if (remaining.length === 0) refill();
    return scenesById.get(remaining.at(-1)) ?? null;
  }

  function nextEntry() {
    const entry = peekEntry();
    if (!entry) throw new Error("cssMaze shuffled bank produced no prepared scene");
    remaining.pop();
    if (entry.id === lastSceneId) {
      throw new Error("cssMaze shuffled bank repeated its previous prepared scene");
    }
    lastSceneId = entry.id;
    persist();
    return entry;
  }

  function persist() {
    writeState(storage, {
      schema: STORAGE_SCHEMA,
      bankSignature: signature,
      lastSceneId,
      remainingSceneIds: remaining,
    });
  }

  return Object.freeze({
    peekEntry,
    nextEntry,
    stats: () => Object.freeze({
      schema: STORAGE_SCHEMA,
      remainingSceneCount: remaining.length,
      lastSceneId,
      randomUint32Count,
      refillCount,
      sessionPersistence: Boolean(storage),
    }),
  });
}

function readState(storage, signature, ids) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY));
    const remaining = value?.remainingSceneIds;
    const allowed = new Set(ids);
    if (value?.schema !== STORAGE_SCHEMA || value.bankSignature !== signature ||
        (value.lastSceneId !== null && !allowed.has(value.lastSceneId)) ||
        !Array.isArray(remaining) || new Set(remaining).size !== remaining.length ||
        remaining.some((id) => !allowed.has(id) || id === value.lastSceneId)) {
      return null;
    }
    return Object.freeze({
      lastSceneId: value.lastSceneId,
      remainingSceneIds: [...remaining],
    });
  } catch {
    return null;
  }
}

function writeState(storage, value) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Selection remains correct when browser storage is unavailable.
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
