export type JsonRecord = Record<string, unknown>;

export function fail(message: string): never {
  throw new TypeError(message);
}

export function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

export function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array.`);
  }
  return value;
}

export function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

export function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be finite.`);
  }
  return Math.fround(value);
}

export function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    fail(`${label} must be a safe integer.`);
  }
  return value as number;
}

export function vec3(
  value: readonly number[],
  label: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    fail(`${label} must have three components.`);
  }
  return Object.freeze([
    finite(value[0], `${label}[0]`),
    finite(value[1], `${label}[1]`),
    finite(value[2], `${label}[2]`),
  ]);
}

export function matrix(value: readonly number[], label: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 16) {
    fail(`${label} must have 16 components.`);
  }
  return Object.freeze(
    value.map((entry, index) => finite(entry, `${label}[${index}]`)),
  );
}
