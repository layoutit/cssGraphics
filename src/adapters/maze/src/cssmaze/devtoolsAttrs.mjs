export function setCssmazeAttrs(element, values) {
  if (!(element instanceof Element)) return;
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    element.setAttribute(`data-cssmaze-${name}`, String(value));
  }
}
