// SPDX-License-Identifier: MIT
import "./cssblackhole/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountBlackHoleClient } from "./cssblackhole/client.mjs";

mountBlackHoleClient(requireExamplesStage());
