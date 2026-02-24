import { createServer } from "./server.js";

const casaName = process.env.MECHA_CASA_NAME;
const port = Number(process.env.MECHA_PORT);
const authToken = process.env.MECHA_AUTH_TOKEN;
const dbPath = process.env.MECHA_DB_PATH;
const workspace = process.env.MECHA_WORKSPACE;
const logDir = process.env.MECHA_LOG_DIR;

/* v8 ignore start -- entrypoint validated at integration level */
if (!casaName || !port || !authToken || !dbPath || !workspace) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const transcriptDir = logDir ? `${logDir}/transcripts` : `${dbPath}/../transcripts`;

const app = createServer({
  casaName,
  port,
  authToken,
  dbPath,
  transcriptDir,
  workspacePath: workspace,
});

app.listen({ port, host: "127.0.0.1" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`CASA ${casaName} listening on port ${port}`);
});
/* v8 ignore stop */
