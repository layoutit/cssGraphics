import "./csssolitaire/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountCsssolitaireClient } from "./csssolitaire/client.mjs";

mountCsssolitaireClient(requireExamplesStage());
