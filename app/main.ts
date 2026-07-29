import "./product.css";
import "../src/style.css";

import {
  CssGraphicsPackageCatalogError,
} from "../src/runtime/shared/catalog.mjs";
import { CssGraphicsPackageError } from "../src/model-package/modelPackage.mjs";
import {
  InvalidCssGraphicsRouteError,
  mountCssGraphics,
} from "../src/index";

const host = document.body;
if (!host) throw new Error("cssGraphics requires a document body.");
const PREPARE_COMMAND =
  "pnpm prepare:super-mario-64 -- --rom /path/to/baserom.us.z64";

function showError(
  code: "missing-prepare" | "invalid-prepare" | "invalid-route",
  headingText: string,
  detailText: string,
): void {
  const panel = document.createElement("section");
  panel.className = "prepare-error";

  const heading = document.createElement("h1");
  heading.textContent = headingText;
  panel.appendChild(heading);

  const detail = document.createElement("p");
  detail.textContent = detailText;
  panel.appendChild(detail);

  if (code !== "invalid-route") {
    const command = document.createElement("code");
    command.textContent = PREPARE_COMMAND;
    panel.appendChild(command);
  }
  host.replaceChildren(panel);
}

async function start(): Promise<void> {
  try {
    await mountCssGraphics(host, { fetchImpl: globalThis.fetch });
  } catch (error) {
    if (error instanceof InvalidCssGraphicsRouteError) {
      showError("invalid-route", "Invalid cssGraphics route", error.message);
      return;
    }
    const missing = (error instanceof CssGraphicsPackageError
      && ["missing-artifact", "missing-prepare"].includes(error.code))
      || (error instanceof CssGraphicsPackageCatalogError && error.code === "missing-catalog");
    const unavailable = error instanceof CssGraphicsPackageCatalogError
      && error.code === "unavailable-model";
    showError(
      unavailable ? "invalid-route" : missing ? "missing-prepare" : "invalid-prepare",
      unavailable ? "Unavailable cssGraphics model" : missing ? "cssGraphics model data is not prepared" : "cssGraphics model preparation is invalid",
      missing
        ? "Prepare the local Mario package catalog, then reload the app."
        : error instanceof Error
          ? error.message
          : "The prepared title-head bundle could not be validated.",
    );
  }
}

void start();
