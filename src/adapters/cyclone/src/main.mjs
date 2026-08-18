// SPDX-License-Identifier: GPL-2.0-or-later
import "./csscyclone/styles.css";
import { mountCycloneClient } from "./csscyclone/client.mjs";

mountCycloneClient(document.body).catch(() => {});
