import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import dotenv from "dotenv";
import { HassWebSocket } from "./websocket.js";
import {
  checkHomeAssistantConnection as checkHass,
  useMockData,
  clearCache,
  getCacheStats,
  HassError,
  HassErrorType,
} from "./utils.js";
import {
  registerEntitiesTools,
  registerHistoryTool,
  registerConfigTools,
  registerServiceTool,
  registerLightTools,
  registerLogTool,
  registerHassTools,
} from "./tools/index.js";
import { serverLogger, apiLogger, websocketLogger } from "./logger.js";

// Load environment variables from .env file
dotenv.config();

// Set up constants and environment variables
const HASS_URL = process.env.HASS_URL || "http://homeassistant.local:8123";
const HASS_TOKEN = process.env.HASS_TOKEN;
const USE_WEBSOCKET = process.env.HASS_WEBSOCKET === "true" || false;

if (!HASS_TOKEN) {
  serverLogger.error(
    "No Home Assistant token found. Please set HASS_TOKEN environment variable.",
  );
  process.exit(1);
}

// Initialize the MCP server
const server = new McpServer({
  name: "hass-mcp",
  version: "1.0.0",
});

// Initialize WebSocket connection if enabled
let wsClient: HassWebSocket | null = null;

// Register all tools with the server
registerHassTools(server, HASS_URL, HASS_TOKEN);

// Support both stdio transport for CLI tools and SSE transport for web clients
if (process.argv.includes("--stdio")) {
  // STDIO mode for local usage
  const stdioTransport = new StdioServerTransport();

  // Check if mock mode is enabled
  const useMock =
    process.argv.includes("--mock") || process.env.HASS_MOCK === "true";
  serverLogger.info(
    `Starting in stdio mode${useMock ? " with mock data" : ""}`,
  );

  // Check Home Assistant connection before starting
  checkHass(HASS_URL, HASS_TOKEN, useMock)
    .then(() => {
      // Initialize WebSocket client if enabled
      if (USE_WEBSOCKET && !useMockData) {
        wsClient = new HassWebSocket(server, HASS_URL, HASS_TOKEN, useMockData);
        // Connect will be called automatically when subscribing
        websocketLogger.info(
          "WebSocket client initialized for real-time updates",
        );
      }

      server.connect(stdioTransport).then(() => {
        serverLogger.info("Home Assistant MCP Server running (stdio mode)");
      });
    })
    .catch((error) => {
      if (error instanceof HassError) {
        serverLogger.error(
          "Failed to connect to Home Assistant",
          {
            errorType: error.type,
            endpoint: error.endpoint,
            retryable: error.retryable,
          },
          error,
        );
      } else {
        serverLogger.error("Unexpected error during startup", {}, error);
      }
    });
} else {
  // Start HTTP server for SSE
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Home Assistant connection status endpoint
  app.get("/ha-status", async (_, res) => {
    try {
      await checkHass(HASS_URL, HASS_TOKEN);
      apiLogger.info("Connection check successful");
      res.send({
        status: "connected",
        message: "Successfully connected to Home Assistant",
      });
    } catch (error) {
      // Enhanced error handling
      let status = 503;
      let message = "Cannot connect to Home Assistant";
      let errorType = "unknown";

      if (error instanceof HassError) {
        message = `Cannot connect to Home Assistant: ${error.message}`;
        errorType = error.type;

        if (error.type === HassErrorType.AUTHENTICATION_FAILED) {
          status = 401;
        } else if (error.type === HassErrorType.RESOURCE_NOT_FOUND) {
          status = 404;
        }

        apiLogger.error(
          "Connection check failed",
          {
            errorType: error.type,
            statusCode: error.statusCode,
            endpoint: error.endpoint,
          },
          error,
        );
      } else {
        apiLogger.error(
          "Connection check failed with unexpected error",
          {},
          error as Error,
        );
      }

      res.status(status).send({
        status: "disconnected",
        message,
        errorType,
        url: HASS_URL,
      });
    }
  });

  // Health check endpoint
  app.get("/health", (_, res) => {
    res.send({ status: "ok" });
  });

  // Cache statistics endpoint
  app.get("/cache-stats", (_, res) => {
    const stats = getCacheStats();
    res.send({
      cacheStats: stats,
      hitRatio: (stats.hits / (stats.hits + stats.misses)) * 100,
    });
  });

  // Cache clear endpoint
  app.post("/clear-cache", (_, res) => {
    clearCache();
    apiLogger.info("Cache cleared via API request");
    res.send({ status: "ok", message: "Cache cleared" });
  });

  // Configure SSE endpoint
  let sseTransport: SSEServerTransport | null = null;

  app.get("/sse", (req, res) => {
    serverLogger.info("SSE client connected", {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });
    sseTransport = new SSEServerTransport("/messages", res);
    server.connect(sseTransport);
  });

  app.post("/messages", (req, res) => {
    if (sseTransport) {
      sseTransport.handlePostMessage(req, res);
    } else {
      res.status(400).send("No SSE session established");
    }
  });

  const httpServer = app.listen(PORT, () => {
    serverLogger.info(`Home Assistant MCP Server listening on port ${PORT}`);

    // Check if mock mode is enabled
    const useMock =
      process.argv.includes("--mock") || process.env.HASS_MOCK === "true";
    if (useMock) {
      serverLogger.info("Mock data mode enabled");
    }

    // Check Home Assistant connection after server starts
    checkHass(HASS_URL, HASS_TOKEN, useMock)
      .then(() => {
        // Initialize WebSocket client if enabled
        if (USE_WEBSOCKET && !useMockData) {
          wsClient = new HassWebSocket(
            server,
            HASS_URL,
            HASS_TOKEN,
            useMockData,
          );
          // Connect will be called automatically when subscribing
          websocketLogger.info(
            "WebSocket client initialized for real-time updates",
          );
        }
      })
      .catch((error) => {
        if (error instanceof HassError) {
          serverLogger.error(
            "Failed to connect to Home Assistant",
            {
              errorType: error.type,
              endpoint: error.endpoint,
              retryable: error.retryable,
            },
            error,
          );
        } else {
          serverLogger.error(
            "Unexpected error during startup",
            {},
            error as Error,
          );
        }
      });
  });

  // Setup process signal handling for cleanup
  process.on("SIGTERM", async () => {
    serverLogger.info("Received SIGTERM, shutting down...");
    if (wsClient) {
      await wsClient
        .close()
        .catch((e) => serverLogger.error("Error closing WebSocket", {}, e));
    }
    httpServer.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    serverLogger.info("Received SIGINT, shutting down...");
    if (wsClient) {
      await wsClient
        .close()
        .catch((e) => serverLogger.error("Error closing WebSocket", {}, e));
    }
    httpServer.close();
    process.exit(0);
  });
}
