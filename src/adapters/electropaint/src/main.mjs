// SPDX-License-Identifier: GPL-2.0-only
import "./cssselectropaint/styles.css";
import { mountElectropaintClient } from "./cssselectropaint/client.mjs";

mountElectropaintClient(document.body).catch(() => {});
