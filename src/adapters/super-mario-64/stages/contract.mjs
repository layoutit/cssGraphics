import { createHash } from "node:crypto";

export function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalTitleHeadValue(value) {
  if (Array.isArray(value)) return value.map(canonicalTitleHeadValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => lexicalCompare(left, right))
      .map(([key, entry]) => [key, canonicalTitleHeadValue(entry)]),
  );
}

export function titleHeadSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function titleHeadContentHash(value) {
  return titleHeadSha256(JSON.stringify(canonicalTitleHeadValue(value)));
}

export function serializeTitleHeadContract(value) {
  return `${JSON.stringify(canonicalTitleHeadValue(value), null, 2)}\n`;
}
