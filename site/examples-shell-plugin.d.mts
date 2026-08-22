import type { Plugin } from "vite";

export function createExamplesShellPlugin(activeProjectId: string): Plugin;
export function renderExamplesInfo(activeProjectId: string): string;
export function renderExamplesSidebar(activeProjectId: string): string;
