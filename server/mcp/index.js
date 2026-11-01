#!/usr/bin/env node
/**
 * Refrain's MCP server, over stdio (`npm run mcp`): tools an assistant (Claude) calls on the machine that holds
 * the church's files. Today that is the script builder: a play's script into a ProPresenter bundle built from
 * the booth's own master slides. The tools themselves are in server.js; this only connects them.
 *
 * It reads Refrain's own config.json on every call. It never writes into ProPresenter's library: drafts and
 * built bundles go to the staging folder (data/probundle-staging), and the person imports a bundle themselves.
 * No telemetry, nothing over the network.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// config.json and the data folder are relative to Refrain's own folder, wherever the assistant starts us from.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(ROOT);
const { loadConfig } = await import("../config.js");
const { createMcpServer } = await import("./server.js");

const server = createMcpServer({ root: ROOT, staging: path.join(ROOT, "data", "probundle-staging"), getConfig: loadConfig });
await server.connect(new StdioServerTransport());
