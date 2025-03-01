import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getHassClient } from "../api/utils.js";
import { apiLogger } from "../logger.js";
import { handleToolError, formatErrorMessage } from "./utils.js";
import { z } from "zod";

/**
 * Register configuration tools for MCP
 */
export function registerConfigTools(server: McpServer): void {
  // Get Home Assistant configuration
  server.tool(
    "config",
    "Get Home Assistant configuration",
    {
      random_string: z
        .string()
        .optional()
        .describe("Dummy parameter for no-parameter tools"),
    },
    async () => {
      try {
        apiLogger.info("Getting Home Assistant configuration");

        const client = getHassClient();
        const config = await client.getConfig();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(config, null, 2),
            },
          ],
        };
      } catch (error) {
        handleToolError("config", error);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error getting configuration: ${formatErrorMessage(error)}`,
            },
          ],
        };
      }
    },
  );
}
