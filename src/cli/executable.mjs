import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CssGraphicsCommandError,
  CSSGRAPHICS_USAGE,
  createCssGraphicsInstallPlan,
  parseCssGraphicsCommand,
} from "./command.mjs";

const PREPARE_TOOLCHAIN_READY = "CSSGRAPHICS_PREPARE_TOOLCHAIN_READY";

function packageMetadata(packageRoot) {
  const metadata = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
  const dependencies = metadata.cssgraphicsPrepareDependencies;
  if (metadata.name !== "cssgraphics" || typeof metadata.version !== "string"
    || !dependencies || typeof dependencies !== "object") {
    throw new Error("The cssGraphics package has no valid preparation toolchain metadata.");
  }
  const packages = Object.entries(dependencies).map(([name, version]) => {
    if (!/^[a-z0-9@][a-z0-9@/._-]*$/u.test(name)
      || typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/iu.test(version)) {
      throw new Error("The cssGraphics preparation toolchain metadata is invalid.");
    }
    return `${name}@${version}`;
  });
  return Object.freeze({ version: metadata.version, packages: Object.freeze(packages) });
}

function runPrepareToolchain(command, { packageRoot, env }) {
  const metadata = packageMetadata(packageRoot);
  const packageSpec = env.CSSGRAPHICS_PACKAGE_SPEC || `cssgraphics@${metadata.version}`;
  const args = [
    "exec",
    "--yes",
    `--package=${packageSpec}`,
    ...metadata.packages.map((dependency) => `--package=${dependency}`),
    "--",
    "cssgraphics",
    command.romPath,
  ];
  const result = spawnSync("npm", args, {
    cwd: command.targetRoot,
    env: {
      ...env,
      CSSGRAPHICS_PACKAGE_SPEC: packageSpec,
      [PREPARE_TOOLCHAIN_READY]: "1",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

export async function main({
  argv = process.argv.slice(2),
  packageRoot,
  env = process.env,
} = {}) {
  try {
    const command = parseCssGraphicsCommand(argv);
    if (command.kind === "help") {
      process.stdout.write(`${CSSGRAPHICS_USAGE}\n`);
      return;
    }
    if (command.romPath && env[PREPARE_TOOLCHAIN_READY] !== "1") {
      runPrepareToolchain(command, { packageRoot, env });
      return;
    }
    const {
      installCssGraphicsDependency,
      runCssGraphicsInstall,
    } = await import("./install.mjs");
    if (!command.romPath) {
      installCssGraphicsDependency({
        targetRoot: command.targetRoot,
        packageRoot,
        env,
      });
      process.stdout.write("Installed the cssgraphics runtime library.\n");
      return;
    }
    const result = await runCssGraphicsInstall(
      createCssGraphicsInstallPlan(command),
      { packageRoot, env },
    );
    process.stdout.write("Installed cssgraphics with the locally prepared Mario model.\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    if (error instanceof CssGraphicsCommandError) {
      process.stderr.write(`${CSSGRAPHICS_USAGE}\n`);
    }
    process.exitCode = 1;
  }
}
