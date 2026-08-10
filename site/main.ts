import "./site.css";
import { PROJECTS } from "./projects";

const list = document.querySelector<HTMLElement>("#asset-list");
if (!list) throw new Error("Missing #asset-list.");

for (const project of PROJECTS) {
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
  number.textContent = `#${String(project.number).padStart(3, "0")}`;
  number.setAttribute("aria-hidden", "true");

  const meta = document.createElement("span");
  meta.className = "project-meta";

  const source = document.createElement("span");
  source.className = "project-source";
  source.textContent = project.source;

  const date = document.createElement("time");
  date.className = "project-date";
  date.dateTime = project.date;
  date.textContent = project.date.replaceAll("-", ".");

  meta.appendChild(source);
  meta.appendChild(date);

  link.appendChild(title);
  link.appendChild(number);
  link.appendChild(meta);
  link.appendChild(image);
  list.appendChild(link);
}
