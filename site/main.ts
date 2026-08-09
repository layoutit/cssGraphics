import "./site.css";

interface LandingProject {
  readonly name: string;
  readonly route: string;
  readonly preview: string;
}

const PROJECTS: readonly LandingProject[] = Object.freeze([
  { name: "Gravity Well", route: "/gravitywell/", preview: "/landing/gravitywell.webp" },
  { name: "Maze", route: "/maze/", preview: "/landing/maze.webp" },
  { name: "Menger", route: "/menger/", preview: "/landing/menger.webp" },
  { name: "Gears", route: "/gears/", preview: "/landing/gears.webp" },
  { name: "Flower Box", route: "/flowerbox/", preview: "/landing/flowerbox.webp" },
  { name: "Pipes", route: "/pipes/", preview: "/landing/pipes.webp" },
]);

const list = document.querySelector<HTMLElement>("#asset-list");
if (!list) throw new Error("Missing #asset-list.");

for (const [index, project] of PROJECTS.entries()) {
  const link = document.createElement("a");
  link.className = "project-thumbnail";
  link.href = project.route;
  link.setAttribute("aria-label", project.name);
  link.title = project.name;

  const image = document.createElement("img");
  image.src = project.preview;
  image.alt = "";
  image.width = 960;
  image.height = 960;
  image.decoding = "async";

  const title = document.createElement("span");
  title.className = "project-title";
  title.textContent = project.name;

  const number = document.createElement("span");
  number.className = "project-number";
  number.textContent = `#${String(index + 1).padStart(3, "0")}`;
  number.setAttribute("aria-hidden", "true");

  link.appendChild(title);
  link.appendChild(number);
  link.appendChild(image);
  list.appendChild(link);
}
