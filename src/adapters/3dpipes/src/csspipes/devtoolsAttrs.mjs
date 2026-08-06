export function applyCssPipesAttributes(element, values) {
  if (!(element instanceof HTMLElement)) throw new TypeError("cssPipes attribute target must be an element");
  for (const [key, value] of Object.entries(values)) {
    if (!/^[a-z][a-z0-9]*$/i.test(key)) throw new TypeError(`Invalid cssPipes data key ${key}`);
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    element.dataset[`csspipes${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
  }
  return element;
}
