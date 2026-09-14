import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountLedAnimation } from "./cssled/client.mjs";
import "./cssled/styles.css";

mountLedAnimation(requireExamplesStage());
