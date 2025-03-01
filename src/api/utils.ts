import type { HassEntity } from "../types";
import type { HassState } from "../types/types";
import { createHassClient } from "./index.js";
// Import and re-export the HassServices type
import type { HassServices } from "./client.js";

export type { HassServices };

/**
 * Singleton instance of the HassClient
 * This ensures only one client is created throughout the application
 */
let clientInstance: ReturnType<typeof createHassClient> | null = null;

/**
 * Get a singleton instance of the HassClient
 *
 * This is the recommended way to get a reference to the client in tool implementations.
 *
 * Example usage:
 * ```typescript
 * // In your tool file:
 * const hassClient = getHassClient(hassUrl, hassToken);
 *
 * // Then use the client methods:
 * const states = await hassClient.getAllStates();
 * const config = await hassClient.getConfig();
 * const serviceResult = await hassClient.callService('light', 'turn_on', { entity_id: 'light.living_room' });
 * ```
 *
 * @param baseUrl The base URL of the Home Assistant API
 * @param token The long-lived access token for authentication
 * @returns A HassClient instance
 */
export function getHassClient(baseUrl: string, token: string) {
  if (!clientInstance) {
    clientInstance = createHassClient(baseUrl, token);
  }
  return clientInstance;
}

/**
 * Convert HassState to HassEntity
 * Used to maintain compatibility with existing code
 *
 * When migrating from direct API calls to the HassClient, use this function
 * to convert HassState objects returned by the client to HassEntity objects
 * expected by the existing application code.
 *
 * @param state The HassState object from client.ts
 * @returns A HassEntity object compatible with the application
 */
export function convertToHassEntity(state: HassState): HassEntity {
  return {
    entity_id: state.entity_id || "",
    state: state.state || "",
    attributes: state.attributes || {},
    last_changed: state.last_changed || "",
    last_updated: state.last_updated || ""
  };
}

/**
 * Convert array of HassState to HassEntity
 * @param states Array of HassState objects
 * @returns Array of HassEntity objects
 *
 * Use this function when dealing with arrays of states, such as those
 * returned by getAllStates().
 *
 * Example:
 * ```typescript
 * // Get all states and convert them to HassEntity objects
 * const states = await hassClient.getAllStates();
 * const entities = convertToHassEntities(states);
 *
 * // Now you can use the entities with existing code that expects HassEntity
 * ```
 */
export function convertToHassEntities(states: HassState[]): HassEntity[] {
  return states.map(convertToHassEntity);
}
