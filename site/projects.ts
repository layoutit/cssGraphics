import projectManifest from "./public/projects.json";

export interface LandingProject {
  readonly number: number;
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly preview: string;
  readonly numberTone: "dark" | "light";
  readonly source: string;
  readonly credits: readonly {
    readonly relation: string;
    readonly name: string;
    readonly url?: string;
  }[];
  readonly description: string;
  readonly date: string;
}

if (projectManifest.schema !== "cssgraphics.projects@2" ||
    !Array.isArray(projectManifest.projects) || projectManifest.projects.length === 0 ||
    !Array.isArray(projectManifest.unlistedProjects)) {
  throw new Error("Invalid css.graphics project manifest.");
}

const ids = new Set<string>();
const numbers = new Set<number>();
export const PROJECTS: readonly LandingProject[] = Object.freeze(
  projectManifest.projects.map((project, index) => {
    const expectedNumber = projectManifest.projects.length - index;
    return validateProject(project, `project ${index}`, expectedNumber);
  }),
);

export const UNLISTED_PROJECTS: readonly LandingProject[] = Object.freeze(
  projectManifest.unlistedProjects.map((project, index) =>
    validateProject(project, `unlisted project ${index}`)),
);

export const ROUTE_PROJECTS: readonly LandingProject[] = Object.freeze([
  ...PROJECTS,
  ...UNLISTED_PROJECTS,
]);

function validateProject(
  project: Omit<LandingProject, "numberTone"> & { readonly numberTone: string },
  label: string,
  expectedNumber?: number,
): LandingProject {
  const numberTone = project.numberTone;
  if ((expectedNumber !== undefined && project.number !== expectedNumber) ||
      !Number.isSafeInteger(project.number) || project.number < 1 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(project.id) ||
      project.route !== `/${project.id}/` ||
      project.preview !== `/landing/${project.id}.webp` ||
      (numberTone !== "dark" && numberTone !== "light") ||
      typeof project.name !== "string" || project.name.length === 0 ||
      typeof project.source !== "string" || project.source.length === 0 ||
      !Array.isArray(project.credits) || project.credits.length === 0 ||
      project.credits.some(({ relation, name, url }) =>
        typeof relation !== "string" || relation.length === 0 ||
        typeof name !== "string" || name.length === 0 ||
        (url !== undefined && !/^https:\/\//u.test(url))) ||
      typeof project.description !== "string" || project.description.length < 40 ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(project.date) ||
      ids.has(project.id) || numbers.has(project.number)) {
    throw new Error(`Invalid css.graphics manifest ${label}.`);
  }
  ids.add(project.id);
  numbers.add(project.number);
  return Object.freeze({ ...project, numberTone });
}
