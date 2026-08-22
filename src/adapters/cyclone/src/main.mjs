// SPDX-License-Identifier: GPL-2.0-or-later
import "./csscyclone/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountCycloneClient } from "./csscyclone/client.mjs";

mountCycloneClient(requireExamplesStage()).catch(() => {});
