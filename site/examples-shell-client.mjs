const search = document.querySelector("#example-search");
const empty = document.querySelector("#empty-results");
const cards = [...document.querySelectorAll(".project-thumbnail")];

if (search instanceof HTMLInputElement && empty instanceof HTMLElement) {
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
}

export function requireExamplesStage() {
  const stage = document.querySelector(".example-stage");
  if (!(stage instanceof HTMLElement)) throw new Error("Missing css.graphics scene stage");
  return stage;
}
