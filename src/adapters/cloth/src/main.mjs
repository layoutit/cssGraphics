import "./csscloth/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountClothClient } from "./csscloth/client.mjs";

mountClothClient(requireExamplesStage());
