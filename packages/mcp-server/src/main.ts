#!/usr/bin/env node
/* v8 ignore start — CLI entrypoint */
import { createDockerClient } from "@mecha/docker";
import { readNodes } from "@mecha/agent";
import { createMeshMcpServer } from "./server.js";
import { runStdio, runHttp } from "./transport.js";

const mode = process.argv[2] ?? "stdio";
const docker = createDockerClient();
const handle = createMeshMcpServer({
  docker,
  getNodes: () => readNodes(),
});

if (mode === "http") {
  const port = Number(process.env.MCP_PORT ?? "7670");
  await runHttp(handle, { port });
} else {
  await runStdio(handle);
}
/* v8 ignore stop */
