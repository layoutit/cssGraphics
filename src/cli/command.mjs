import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

// Public command parsing stays separate from preparation and browser runtime code.
export const CSSGRAPHICS_COMMAND_SCHEMA = "cssgraphics.command.v1";
export const CSSGRAPHICS_INSTALL_PLAN_SCHEMA = "cssgraphics.install-plan.v1";
export const CSSGRAPHICS_USAGE = "Usage: npx cssgraphics [/path/to/rom.z64]";

export class CssGraphicsCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CssGraphicsCommandError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CssGraphicsCommandError(code, message);
}

function regularFile(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") fail("rom-not-found", `ROM not found: ${path}`);
    throw error;
  }
  if (stat.isSymbolicLink()) fail("rom-symlink", "The ROM path must not be a symbolic link.");
  if (!stat.isFile()) fail("rom-not-file", "The ROM path must resolve to a regular file.");
  return realpathSync(path);
}

export function parseCssGraphicsCommand(argv, { cwd = process.cwd() } = {}) {
  if (!Array.isArray(argv)) fail("invalid-arguments", CSSGRAPHICS_USAGE);
  if (argv.length > 1) fail("too-many-arguments", CSSGRAPHICS_USAGE);
  if (argv.length === 1 && new Set(["--help", "-h"]).has(argv[0])) {
    return Object.freeze({
      schema: CSSGRAPHICS_COMMAND_SCHEMA,
      kind: "help",
    });
  }
  if (argv[0]?.startsWith("-")) fail("invalid-arguments", CSSGRAPHICS_USAGE);
  const targetRoot = realpathSync(resolve(cwd));
  const romPath = argv.length === 0 ? null : regularFile(resolve(targetRoot, argv[0]));
  return Object.freeze({
    schema: CSSGRAPHICS_COMMAND_SCHEMA,
    kind: "install",
    targetRoot,
    romPath,
  });
}

export function createCssGraphicsInstallPlan(command) {
  if (!command || command.schema !== CSSGRAPHICS_COMMAND_SCHEMA) {
    fail("invalid-command", "A parsed cssgraphics command is required.");
  }
  if (command.kind !== "install") {
    fail("invalid-command", "An install command is required.");
  }
  const operations = ["install-library"];
  if (command.romPath) operations.push("prepare-rom-model");
  return Object.freeze({
    schema: CSSGRAPHICS_INSTALL_PLAN_SCHEMA,
    targetRoot: command.targetRoot,
    romPath: command.romPath,
    operations: Object.freeze(operations),
  });
}
