const context = process.env.CONTEXT ?? "";
const skip = context === "deploy-preview";

console.log(skip
  ? "Skipping css.graphics deploy preview; use local adapter proof instead."
  : `Running css.graphics ${context || "unspecified-context"} build.`);

process.exitCode = skip ? 0 : 1;
