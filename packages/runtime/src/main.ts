import { createServer } from "./server.js";

const casaName = process.env.MECHA_CASA_NAME;
const port = Number(process.env.MECHA_PORT);
const authToken = process.env.MECHA_AUTH_TOKEN;
const projectsDir = process.env.MECHA_PROJECTS_DIR;
const workspace = process.env.MECHA_WORKSPACE;
const mechaDir = process.env.MECHA_DIR;

/* v8 ignore start -- entrypoint validated at integration level */
if (!casaName || !port || !authToken || !projectsDir || !workspace) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const casaDir = process.env.MECHA_SANDBOX_ROOT;

const { app } = createServer({
  casaName,
  port,
  authToken,
  projectsDir,
  workspacePath: workspace,
  mechaDir,
  casaDir,
});

app.listen({ port, host: "127.0.0.1" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`CASA ${casaName} listening on port ${port}`);
});

process.on("SIGTERM", () => { app.close(); });
/* v8 ignore stop */
