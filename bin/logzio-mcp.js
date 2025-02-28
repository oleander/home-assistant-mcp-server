#!/usr/bin/env node

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { spawn } from "child_process";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the dist/index.js file
const serverPath = resolve(__dirname, "../dist/index.js");

// Write to stderr instead of stdout to avoid interfering with MCP protocol
console.error("Starting Logz.io MCP Server...");

// Start the server with direct pipes (don't use inherit for stdio)
const server = spawn("node", [serverPath], {
  // Use pipe instead of inherit to allow direct protocol communication
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

// Connect the server's stdio to process stdio for MCP communication
server.stdout.pipe(process.stdout);
process.stdin.pipe(server.stdin);
server.stderr.pipe(process.stderr);

// Handle server exit
server.on("close", (code) => {
  if (code !== 0) {
    console.error(`Server process exited with code ${code}`);
  }
  process.exit(code);
});

// Handle process signals
process.on("SIGINT", () => {
  server.kill("SIGINT");
});

process.on("SIGTERM", () => {
  server.kill("SIGTERM");
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  server.kill("SIGTERM");
  process.exit(1);
});
