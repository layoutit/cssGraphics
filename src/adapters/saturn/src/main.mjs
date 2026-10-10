import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountSaturn } from "./csssaturn/client.mjs";
import "./csssaturn/styles.css";

mountSaturn(requireExamplesStage());
