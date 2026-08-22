// SPDX-License-Identifier: GPL-2.0-only
import "./cssselectropaint/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountElectropaintClient } from "./cssselectropaint/client.mjs";

mountElectropaintClient(requireExamplesStage()).catch(() => {});
