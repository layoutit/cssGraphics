// SPDX-License-Identifier: GPL-2.0-or-later
import "./cssflocks/styles.css";
import { mountFlocksClient } from "./cssflocks/client.mjs";

mountFlocksClient(document.body).catch(() => {});
