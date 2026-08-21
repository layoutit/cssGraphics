import "./site.css";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing landing element: ${selector}`);
  return element;
}

const frame = required<HTMLIFrameElement>("#example-frame");
const openLink = required<HTMLAnchorElement>(".open-example");
const loading = required<HTMLElement>(".viewer-loading");
const search = required<HTMLInputElement>("#example-search");
const empty = required<HTMLElement>("#empty-results");
const cards = [...document.querySelectorAll<HTMLAnchorElement>(".project-thumbnail")];

if (cards.length === 0) throw new Error("The css.graphics project list is empty.");

function select(card: HTMLAnchorElement, updateHistory: boolean): void {
  const route = card.getAttribute("href");
  const name = card.dataset.projectName;
  if (!route || !name) return;

  for (const item of cards) item.removeAttribute("aria-current");
  card.setAttribute("aria-current", "true");
  frame.title = `${name} example`;
  if (frame.getAttribute("src") !== route) {
    loading.hidden = false;
    loading.textContent = `Loading ${name}…`;
    frame.src = route;
  }
  openLink.href = route;
  openLink.setAttribute("aria-label", `Open ${name} in this window`);

  if (updateHistory) {
    const url = new URL(location.href);
    url.searchParams.set("example", card.dataset.projectId ?? "");
    history.pushState({}, "", url);
  }
}

for (const card of cards) {
  card.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(card, true);
  });
}

search.addEventListener("input", () => {
  const query = search.value.trim().toLowerCase();
  let visible = 0;
  for (const card of cards) {
    const text = `${card.dataset.projectName ?? ""} ${card.dataset.projectSource ?? ""}`.toLowerCase();
    card.hidden = query.length > 0 && !text.includes(query);
    if (!card.hidden) visible += 1;
  }
  empty.hidden = visible !== 0;
});

frame.addEventListener("load", () => {
  loading.hidden = true;
});

function selectFromLocation(): void {
  const id = new URL(location.href).searchParams.get("example");
  const card = cards.find((item) => item.dataset.projectId === id);
  if (card) select(card, false);
}

addEventListener("popstate", selectFromLocation);
selectFromLocation();
