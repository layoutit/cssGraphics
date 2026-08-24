// SPDX-License-Identifier: HPND
import "./cssgalaxy/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountGalaxyClient } from "./cssgalaxy/client.mjs";

mountGalaxyClient(requireExamplesStage()).catch(() => {});
