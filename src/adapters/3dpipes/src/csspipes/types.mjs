export class CssPipesContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "CssPipesContractError";
  }
}

export function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CssPipesContractError(`${label} must be an object`);
  }
  return value;
}

export function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CssPipesContractError(`${label} must be a non-empty string`);
  }
  return value;
}

export function safeGeneratedUrl(value, label) {
  const url = nonEmptyString(value, label);
  let normalized;
  try {
    normalized = new URL(url, "https://csspipes.invalid/");
  } catch {
    throw new CssPipesContractError(`${label} is not a valid URL`);
  }
  if (normalized.origin !== "https://csspipes.invalid" ||
      !normalized.pathname.startsWith("/csspipes/") ||
      normalized.search || normalized.hash) {
    throw new CssPipesContractError(`${label} is outside the generated cssPipes root`);
  }
  return normalized.pathname;
}
