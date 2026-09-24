#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, clientFromEnv, serverOptionsFromEnv } from "./server";

async function main() {
  const client = clientFromEnv();
  const options = serverOptionsFromEnv();
  const server = buildServer(client, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the protocol channel; anything human goes to stderr.
  process.stderr.write(`markaestro-mcp ready (${client.isTestKey ? "test" : "live"} key, ${client.baseUrl}${options.readOnly ? ", read-only" : ""})\n`);
}

main().catch((error) => {
  process.stderr.write(`markaestro-mcp failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
