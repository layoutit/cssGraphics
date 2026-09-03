// SPDX-License-Identifier: HPND
import "./csscityflow/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountCityflow } from "./csscityflow/client.mjs";

mountCityflow(requireExamplesStage());
