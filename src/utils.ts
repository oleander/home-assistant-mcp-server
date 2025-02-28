// Helper functions for Home Assistant API interactions

// Remove unused imports
import type {} from /* HassEntity, HassConfig, HassService, HassEvent */ "./types.js";

// Global state tracking
export let homeAssistantAvailable = false;

/**
 * Error types for Home Assistant API interactions
 */
export enum HassErrorType {
  CONNECTION_TIMEOUT = "connection_timeout",
  CONNECTION_REFUSED = "connection_refused",
  AUTHENTICATION_FAILED = "authentication_failed",
  RESOURCE_NOT_FOUND = "resource_not_found",
  SERVER_ERROR = "server_error",
  NETWORK_ERROR = "network_error",
  UNKNOWN_ERROR = "unknown_error",
}

/**
 * Enhanced error class for Home Assistant API errors
 */
export class HassError extends Error {
  type: HassErrorType;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  retryable: boolean;
  recommendedAction?: string;

  constructor(
    message: string,
    type: HassErrorType = HassErrorType.UNKNOWN_ERROR,
    options: {
      endpoint?: string;
      method?: string;
      statusCode?: number;
      retryable?: boolean;
      recommendedAction?: string;
      cause?: Error;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.type = type;
    this.endpoint = options.endpoint;
    this.method = options.method;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.recommendedAction = options.recommendedAction;
    this.name = "HassError";
  }

  /**
   * Create a formatted error message with all details
   */
  getDetailedMessage(): string {
    const details = [
      `Error Type: ${this.type}`,
      this.endpoint ? `Endpoint: ${this.endpoint}` : null,
      this.method ? `Method: ${this.method}` : null,
      this.statusCode ? `Status Code: ${this.statusCode}` : null,
      this.retryable
        ? "This error is retryable."
        : "This error is not retryable.",
      this.recommendedAction
        ? `Recommendation: ${this.recommendedAction}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    return `${this.message}\n\n${details}`;
  }

  /**
   * Log this error to the console with proper formatting
   */
  logError(): void {
    console.error("Home Assistant API Error:");
    console.error(this.getDetailedMessage());
    if (this.cause) {
      console.error("\nOriginal Error:");
      console.error(this.cause);
    }
  }
}

/**
 * Create an appropriate HassError from a standard error
 */
export function createHassError(
  originalError: unknown,
  endpoint?: string,
  method?: string,
): HassError {
  // Default values
  let message = "Unknown error occurred when communicating with Home Assistant";
  let type = HassErrorType.UNKNOWN_ERROR;
  let statusCode: number | undefined = undefined;
  let retryable = false;
  let recommendedAction = "Check Home Assistant logs for more details.";

  // Cast original error
  const err = originalError as Error & {
    name?: string;
    cause?: { code?: string };
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };

  // Determine error type based on error properties
  if (err.name === "AbortError") {
    type = HassErrorType.CONNECTION_TIMEOUT;
    message = `Request to Home Assistant timed out${endpoint ? ` for ${endpoint}` : ""}`;
    retryable = true;
    recommendedAction =
      "Check if Home Assistant is overloaded or if there are network issues.";
  } else if (err.cause && err.cause.code === "ECONNREFUSED") {
    type = HassErrorType.CONNECTION_REFUSED;
    message = "Connection refused to Home Assistant";
    retryable = true;
    recommendedAction =
      "Verify Home Assistant is running and network connectivity is available.";
  } else if (
    err.status === 401 ||
    err.statusCode === 401 ||
    err.response?.status === 401
  ) {
    type = HassErrorType.AUTHENTICATION_FAILED;
    message = "Authentication failed with Home Assistant";
    statusCode = 401;
    recommendedAction = "Check your Home Assistant API token and permissions.";
  } else if (
    err.status === 404 ||
    err.statusCode === 404 ||
    err.response?.status === 404
  ) {
    type = HassErrorType.RESOURCE_NOT_FOUND;
    message = `Resource not found${endpoint ? ` at ${endpoint}` : ""}`;
    statusCode = 404;
    recommendedAction =
      "Verify the endpoint is correct and exists in your Home Assistant instance.";
  } else if (
    (err.status && err.status >= 500) ||
    (err.statusCode && err.statusCode >= 500) ||
    (err.response?.status && err.response.status >= 500)
  ) {
    type = HassErrorType.SERVER_ERROR;
    message = "Home Assistant server error";
    statusCode = err.status || err.statusCode || err.response?.status;
    retryable = true;
    recommendedAction = "Check Home Assistant logs for server-side errors.";
  }

  // Use original error message if available
  if (err.message) {
    message = err.message;
  }

  return new HassError(message, type, {
    endpoint,
    method,
    statusCode,
    retryable,
    recommendedAction,
    cause: err,
  });
}

/**
 * Cache options for API requests
 */
interface CacheOptions {
  ttl: number; // Time to live in milliseconds
  staleWhileRevalidate?: boolean;
  bypassCache?: boolean;
}

/**
 * Cache entry for storing API responses
 */
interface CacheEntry<T> {
  data: T;
  expires: number;
  lastUpdated: number;
}

/**
 * API cache for improved performance
 */
class ApiCache {
  private memoryCache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultOptions: CacheOptions = { ttl: 60000 }; // 1 minute default
  private cacheHits = 0;
  private cacheMisses = 0;
  private cacheExpired = 0;

  /**
   * Get an item from cache or fetch it if not available
   */
  async get<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options?: Partial<CacheOptions>,
  ): Promise<T> {
    const opts = { ...this.defaultOptions, ...options };

    // If cache bypass is requested, skip cache lookup
    if (opts.bypassCache) {
      this.cacheMisses++;
      const data = await fetchFn();
      this.set(key, data, opts);
      return data;
    }

    const entry = this.memoryCache.get(key);
    const now = Date.now();

    // Check if cache entry exists and is not expired
    if (entry && entry.expires > now) {
      this.cacheHits++;
      return entry.data as T;
    }

    // If stale-while-revalidate is enabled and we have a stale entry, use it
    // but refresh it in the background
    if (opts.staleWhileRevalidate && entry) {
      this.cacheExpired++;

      // Refresh in background
      setTimeout(async () => {
        try {
          const freshData = await fetchFn();
          this.set(key, freshData, opts);
        } catch (error) {
          console.error(`Error refreshing cache for ${key}:`, error);
        }
      }, 0);

      return entry.data as T;
    }

    // Cache miss or expired without stale-while-revalidate
    this.cacheMisses++;
    const data = await fetchFn();
    this.set(key, data, opts);
    return data as T;
  }

  /**
   * Store an item in the cache
   */
  set<T>(key: string, data: T, options?: Partial<CacheOptions>): void {
    const opts = { ...this.defaultOptions, ...options };
    const now = Date.now();

    this.memoryCache.set(key, {
      data,
      expires: now + opts.ttl,
      lastUpdated: now,
    });
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(keyPattern: string | RegExp): void {
    const pattern =
      keyPattern instanceof RegExp ? keyPattern : new RegExp(keyPattern);

    for (const key of this.memoryCache.keys()) {
      if (pattern.test(key)) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Invalidate all cache entries
   */
  clear(): void {
    this.memoryCache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; expired: number; size: number } {
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      expired: this.cacheExpired,
      size: this.memoryCache.size,
    };
  }

  /**
   * Handle entity state change for cache invalidation
   */
  handleEntityUpdate(entityId: string): void {
    // Invalidate specific entity
    this.invalidate(`/states/${entityId}`);

    // Invalidate all states
    this.invalidate("/states");

    // Invalidate entity-specific templates and service calls
    this.invalidate(new RegExp(`.*${entityId}.*`));
  }

  /**
   * Handle service call for cache invalidation
   */
  handleServiceCall(domain: string, service: string): void {
    // Invalidate service-related caches
    this.invalidate(`/services/${domain}/${service}`);

    // Invalidate all states as service calls usually change states
    this.invalidate("/states");
  }
}

// Create global cache instance
export const apiCache = new ApiCache();

/**
 * Generate a cache key from request parameters
 */
function generateCacheKey(
  endpoint: string,
  method: string,
  data?: Record<string, unknown>,
): string {
  let key = `${method}:${endpoint}`;

  if (data && Object.keys(data).length > 0) {
    key += `:${JSON.stringify(data)}`;
  }

  return key;
}

/**
 * Determine if a request should be cached based on endpoint and method
 */
function isCacheable(endpoint: string, method: string): boolean {
  // Only cache GET requests
  if (method !== "GET") return false;

  // Cache config, states, services, and other read-only endpoints
  if (
    endpoint === "/config" ||
    endpoint === "/states" ||
    endpoint.startsWith("/states/") ||
    endpoint === "/services" ||
    endpoint === "/events"
  ) {
    return true;
  }

  return false;
}

/**
 * Determine appropriate TTL for different endpoints
 */
function getCacheTTL(endpoint: string): number {
  if (endpoint === "/config") {
    return 3600000; // Config changes infrequently (1 hour)
  }

  if (endpoint === "/services" || endpoint === "/events") {
    return 300000; // Services and events change occasionally (5 minutes)
  }

  if (endpoint === "/states" || endpoint.startsWith("/states/")) {
    return 15000; // States change frequently (15 seconds)
  }

  return 60000; // Default 1 minute
}

/**
 * Helper function to make requests to Home Assistant API with customizable response parsing
 */
export async function makeHassRequest<T = unknown>(
  endpoint: string,
  hassUrl: string,
  hassToken: string,
  method: "GET" | "POST" = "GET",
  data?: Record<string, unknown>,
  options?: {
    cacheOptions?: Partial<CacheOptions>;
    parser?: ResponseParser<T>;
  },
): Promise<T> {
  // Extract options with defaults
  const {
    cacheOptions,
    parser = new AutoParser<T>(), // Default to auto parser
  } = options || {};

  // Check if the request is cacheable
  const shouldCache = isCacheable(endpoint, method);
  const cacheKey = shouldCache ? generateCacheKey(endpoint, method, data) : "";

  // If cacheable and no specific cache options provided, use default for this endpoint
  const defaultCacheOptions = shouldCache
    ? {
        ttl: getCacheTTL(endpoint),
        staleWhileRevalidate: true,
      }
    : undefined;

  const finalCacheOptions = { ...defaultCacheOptions, ...cacheOptions };

  // If cacheable, try to get from cache
  if (shouldCache) {
    return apiCache.get<T>(
      cacheKey,
      () =>
        performHassRequest<T>(
          endpoint,
          hassUrl,
          hassToken,
          method,
          data,
          parser,
        ),
      finalCacheOptions,
    );
  }

  // Not cacheable, perform request directly
  return performHassRequest<T>(
    endpoint,
    hassUrl,
    hassToken,
    method,
    data,
    parser,
  );
}

/**
 * Perform the actual HTTP request to Home Assistant
 */
async function performHassRequest<T = unknown>(
  endpoint: string,
  hassUrl: string,
  hassToken: string,
  method: "GET" | "POST" = "GET",
  data?: Record<string, unknown>,
  parser: ResponseParser<T> = new AutoParser<T>(),
): Promise<T> {
  try {
    const url = new URL(hassUrl);
    url.pathname = "/api" + endpoint;

    // For debugging
    // console.debug(`${method} ${url.toString()}`);

    // Prepare request
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${hassToken}`,
        "Content-Type": parser.contentType || "application/json",
        Accept: "application/json", // Default to JSON, will be overridden if needed
      },
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    console.error(
      `Making request to Home Assistant: ${method} ${url.toString()} (parser: ${parser.constructor.name})`,
    );

    // Add a timeout to avoid hanging indefinitely
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    options.signal = controller.signal;

    const response = await fetch(url, options);
    clearTimeout(timeoutId);

    // If we get a successful response, update availability flag
    homeAssistantAvailable = true;

    if (!response.ok) {
      throw new HassError(
        `Home Assistant API error: ${response.status} ${response.statusText}`,
        response.status === 404
          ? HassErrorType.RESOURCE_NOT_FOUND
          : response.status === 401
            ? HassErrorType.AUTHENTICATION_FAILED
            : response.status >= 500
              ? HassErrorType.SERVER_ERROR
              : HassErrorType.UNKNOWN_ERROR,
        {
          endpoint,
          method,
          statusCode: response.status,
          retryable: response.status >= 500,
          recommendedAction:
            response.status === 401
              ? "Check your API token and permissions."
              : response.status === 404
                ? "Verify the endpoint exists in your Home Assistant instance."
                : "Check Home Assistant logs for more details.",
        },
      );
    }

    // Log response content type for debugging
    const contentType = response.headers.get("content-type") || "";
    console.error(`Response content-type: '${contentType}'`);

    // Use the provided parser to handle the response
    return await parser.parse(response);
  } catch (error: unknown) {
    // Create a structured error
    const hassError =
      error instanceof HassError
        ? error
        : createHassError(error, endpoint, method);

    // Log the error with detailed information
    hassError.logError();

    // Mark Home Assistant as unavailable
    homeAssistantAvailable = false;

    // Rethrow the enhanced error
    throw hassError;
  }
}

/**
 * Invalidate API cache for a specific entity or endpoint
 */
export function invalidateCache(pattern: string | RegExp): void {
  apiCache.invalidate(pattern);
}

/**
 * Clear the entire API cache
 */
export function clearCache(): void {
  apiCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  hits: number;
  misses: number;
  expired: number;
  size: number;
} {
  return apiCache.getStats();
}

/**
 * Check if Home Assistant is available
 * @returns true if available, false otherwise
 */
export async function checkHomeAssistantConnection(
  hassUrl: string,
  hassToken: string,
): Promise<boolean> {
  try {
    console.error(`Checking connectivity to Home Assistant at ${hassUrl}`);
    await makeHassRequest("/config", hassUrl, hassToken, "GET", undefined, {
      parser: new JsonParser(),
    });
    console.error("✅ Successfully connected to Home Assistant!");
    homeAssistantAvailable = true;
    return true;
  } catch (error) {
    const hassError =
      error instanceof HassError
        ? error
        : createHassError(error, "/config", "GET");

    console.error("❌ Could not connect to Home Assistant:");
    hassError.logError();

    // Connection is not available
    homeAssistantAvailable = false;
    return false;
  }
}

// Parser types for response handling
export interface ResponseParser<T> {
  parse(response: Response): Promise<T>;
  contentType?: string;
}

// JSON parser - parses JSON responses
export class JsonParser<T> implements ResponseParser<T> {
  contentType = "application/json";

  async parse(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch (error) {
      console.error(`Error parsing JSON response: ${error}`);
      throw new HassError(
        `Failed to parse JSON response: ${error}`,
        HassErrorType.UNKNOWN_ERROR,
      );
    }
  }
}

// Text parser - returns raw text
export class TextParser implements ResponseParser<string> {
  contentType = "text/plain";

  async parse(response: Response): Promise<string> {
    return await response.text();
  }
}

// Raw parser - wraps text in an object
export class RawParser
  implements ResponseParser<{ text: string; contentType: string }>
{
  async parse(
    response: Response,
  ): Promise<{ text: string; contentType: string }> {
    const contentType = response.headers.get("content-type") || "text/plain";
    const text = await response.text();
    return { text, contentType };
  }
}

// Auto parser - tries JSON first, falls back to text, but always returns type T
export class AutoParser<T> implements ResponseParser<T> {
  async parse(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type") || "";

    // Try JSON for application/json content type
    if (contentType.includes("application/json")) {
      try {
        return (await response.json()) as T;
      } catch (error) {
        console.error(`Error parsing JSON response: ${error}`);
        // For AutoParser, we'll try to convert text to the expected type
        const text = await response.text();

        // If T is a string type, return the text directly
        if ((typeof "" as unknown as T) === "string") {
          return text as unknown as T;
        }

        // Otherwise wrap it in an object (best effort)
        return {
          text,
          contentType,
        } as unknown as T;
      }
    }

    // For text content types
    const text = await response.text();

    // If T is a string type, return the text directly
    if ((typeof "" as unknown as T) === "string") {
      return text as unknown as T;
    }

    // Otherwise wrap it in an object (best effort)
    return {
      text,
      contentType,
    } as unknown as T;
  }
}

// Custom parser that attempts to convert any response to a specific type
export class CustomParser<T> implements ResponseParser<T> {
  constructor(private converter: (data: unknown) => T) {}

  async parse(response: Response): Promise<T> {
    let data: unknown;

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        data = await response.json();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_unused) {
        // Ignore JSON parsing error and fall back to text
        data = await response.text();
      }
    } else {
      data = await response.text();
    }

    return this.converter(data);
  }
}

// Helper functions for parser usage
export function asJson<T>(): JsonParser<T> {
  return new JsonParser<T>();
}

export function asText(): TextParser {
  return new TextParser();
}

export function asRaw(): RawParser {
  return new RawParser();
}

export function asAuto<T>(): AutoParser<T> {
  return new AutoParser<T>();
}

export function withCustomParser<T>(
  converter: (data: unknown) => T,
): CustomParser<T> {
  return new CustomParser<T>(converter);
}
