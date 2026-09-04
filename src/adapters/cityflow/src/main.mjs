// SPDX-License-Identifier: HPND
import "./csscityflow/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { selectCityflowPreparedBank } from "./csscityflow/profileSelection.mjs";

const host = requireExamplesStage();
const bankId = selectCityflowPreparedBank({
  width: host.clientWidth || innerWidth,
  height: host.clientHeight || innerHeight,
});
const { mountCityflow } = bankId === "mobile"
  ? await import("./csscityflow/mobileClient.mjs")
  : await import("./csscityflow/client.mjs");
mountCityflow(host, bankId);
