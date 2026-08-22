import "./cssmenger/styles.css";
import { requireExamplesStage } from "../../../../site/examples-shell-client.mjs";
import { mountCssmengerClient } from "./cssmenger/client.mjs";

mountCssmengerClient(requireExamplesStage());
