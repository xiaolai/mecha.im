#!/usr/bin/env node
/* v8 ignore start — CLI entrypoint */
import { createProcessManager } from "@mecha/process";
import { readNodes } from "@mecha/agent";
import { createMeshMcpServer } from "./server.js";
import { runStdio, runHttp } from "./transport.js";

const mode = process.argv[2] ?? "stdio";
const pm = createProcessManager();
const handle = createMeshMcpServer({
  pm,
  getNodes: () => readNodes(),
});

if (mode === "http") {
  const port = Number(process.env.MCP_PORT ?? "7670");
  await runHttp(handle, { port });
} else {
  await runStdio(handle);
}
/* v8 ignore stop */
