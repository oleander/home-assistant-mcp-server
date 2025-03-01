import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getHassClient } from "../api/utils.js";
import { apiLogger } from "../logger.js";
import { handleToolError } from "./utils.js";

/**
 * Register device tools for MCP
 */
export function registerDeviceTools(server: McpServer): void {
  server.tool(
    "devices",
    "Get all devices in Home Assistant",
    {
      random_string: z
        .string()
        .optional()
        .describe("Dummy parameter for no-parameter tools"),
    },
    async () => {
      try {
        apiLogger.info("Getting devices");

        const client = getHassClient();
        // Get devices using the client API - using config endpoint as fallback since getDeviceRegistry doesn't exist
        const response = await client.getConfig();

        // Extract relevant device information
        const devices = response.components?.filter(component =>
          component.startsWith("device_tracker") ||
          component.startsWith("light.") ||
          component.startsWith("switch.")
        ) || [];

        apiLogger.info(`Found ${devices.length} device-related components`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ devices }, null, 2),
            },
          ],
        };
      } catch (error) {
        handleToolError("devices", error);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Error retrieving devices information",
            },
          ],
        };
      }
    }
  );
}
