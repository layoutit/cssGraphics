// SPDX-License-Identifier: GPL-2.0-only
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
export const localSourceRoot = resolve(adapterRoot, "..", "..", "..", ".local", "electropaint");
export const generatedPublicRoot = resolve(repositoryRoot, "build", "generated", "public");
export const generatedAdapterRoot = resolve(generatedPublicRoot, "cssselectropaint");
export const generatedVariantsRoot = resolve(generatedAdapterRoot, "variants");
export const manifestPath = resolve(generatedAdapterRoot, "manifest.json");

export const manifestUrl = "/cssselectropaint/manifest.json";

export function variantRoot(id) { return resolve(generatedVariantsRoot, id); }
export function timelineChunksRootFor(id) { return resolve(variantRoot(id), "chunks"); }
export function sourceScenePathFor(id) { return resolve(variantRoot(id), "source-scene.json"); }
export function runtimeScenePathFor(id) { return resolve(variantRoot(id), "scene.json.gz"); }
export function snapshotPathFor(id) { return resolve(variantRoot(id), "snapshot.html.gz"); }
export function sourceSceneUrlFor(id) { return `/cssselectropaint/variants/${id}/source-scene.json`; }
export function runtimeSceneUrlFor(id) { return `/cssselectropaint/variants/${id}/scene.json.gz`; }
export function snapshotUrlFor(id) { return `/cssselectropaint/variants/${id}/snapshot.html.gz`; }
