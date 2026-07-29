import { package as packagePreparedModel } from "./package.mjs";
import { prepare as prepareModel } from "./prepare.mjs";

export const metadata = Object.freeze({
  id: "super-mario-64",
  modelId: "mario",
  name: "Mario",
  profile: "super-mario-64",
});

export const prepare = prepareModel;
export { packagePreparedModel as package };
