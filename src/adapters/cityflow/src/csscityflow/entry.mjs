// SPDX-License-Identifier: HPND
import { selectCityflowPreparedBank } from "./profileSelection.mjs";

// Both the standalone adapter and the production scene router use this entry.
export async function mountCityflow(host) {
  const bankId = selectCityflowPreparedBank({
    width: host.clientWidth || innerWidth,
    height: host.clientHeight || innerHeight,
  });
  const runtime = bankId === "mobile"
    ? await import("./mobileClient.mjs")
    : await import("./client.mjs");
  return runtime.mountCityflow(host, bankId);
}
