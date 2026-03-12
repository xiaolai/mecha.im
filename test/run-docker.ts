import { execFileSync } from "node:child_process";
import { join } from "node:path";

const suites = [
  "t8-docker.ts",
  "t9-cli.ts",
  "integration.test.ts",
];

for (const suite of suites) {
  const file = join(import.meta.dirname, suite);
  console.log(`Running ${suite}`);
  execFileSync("npx", ["tsx", file], {
    stdio: "inherit",
    env: { ...process.env },
  });
}
