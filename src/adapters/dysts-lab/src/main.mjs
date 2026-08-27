// SPDX-License-Identifier: MIT
import "./cssdysts/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountChaosClient } from "./cssdysts/client.mjs";

mountChaosClient(requireExamplesStage());
