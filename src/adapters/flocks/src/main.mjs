// SPDX-License-Identifier: GPL-2.0-or-later
import "./cssflocks/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountFlocksClient } from "./cssflocks/client.mjs";

mountFlocksClient(requireExamplesStage()).catch(() => {});
