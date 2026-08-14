import projectManifest from "./public/projects.json";

export interface LandingProject {
  readonly number: number;
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly preview: string;
  readonly source: string;
  readonly description: string;
  readonly date: string;
}

if (projectManifest.schema !== "cssgraphics.projects@2" ||
    !Array.isArray(projectManifest.projects) || projectManifest.projects.length === 0) {
  throw new Error("Invalid css.graphics project manifest.");
}

const ids = new Set<string>();
const numbers = new Set<number>();
export const PROJECTS: readonly LandingProject[] = Object.freeze(
  projectManifest.projects.map((project, index) => {
    const expectedNumber = projectManifest.projects.length - index;
    if (project.number !== expectedNumber ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(project.id) ||
        project.route !== `/${project.id}/` ||
        project.preview !== `/landing/${project.id}.webp` ||
        typeof project.name !== "string" || project.name.length === 0 ||
        typeof project.source !== "string" || project.source.length === 0 ||
        typeof project.description !== "string" || project.description.length < 40 ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(project.date) ||
        ids.has(project.id) || numbers.has(project.number)) {
      throw new Error(`Invalid css.graphics project manifest entry at index ${index}.`);
    }
    ids.add(project.id);
    numbers.add(project.number);
    return Object.freeze(project);
  }),
);
