import { execFileSync } from "node:child_process";
import { join } from "node:path";

const suites = [
  "t2-shared.ts",
  "t3-agent-modules.ts",
  "t4-config-auth.ts",
  "t5-server-routes.ts",
  "t6-webhook.ts",
  "t7-scheduler.ts",
  "t11-fleet-dashboard-auth.ts",
  "t14-resolver.ts",
  "t15-interbot-auth.ts",
  "t16-container-runtime.ts",
];

for (const suite of suites) {
  const file = join(import.meta.dirname, suite);
  console.log(`Running ${suite}`);
  execFileSync("npx", ["tsx", file], {
    stdio: "inherit",
    env: { ...process.env },
  });
}
