export function selectClothStartingBank(bankCount, readRandomUint32 = cryptoRandomUint32) {
  if (!Number.isSafeInteger(bankCount) || bankCount < 2) {
    throw new RangeError("Cloth starting-bank selection needs at least two prepared banks");
  }
  const value = readRandomUint32();
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError("Cloth starting-bank selector returned an invalid uint32");
  }
  return Math.floor((value / 0x1_0000_0000) * bankCount);
}

function cryptoRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}
