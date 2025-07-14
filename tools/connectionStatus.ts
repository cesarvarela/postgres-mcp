import { z, ZodRawShape } from "zod";
import {
  McpToolResponse,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  getConnectionStatus,
  retryConnection,
  debug,
} from "./utils.js";

// Zod schema for input validation
export const connectionStatusShape: ZodRawShape = {
  retry: z.boolean().optional().default(false),
};

export const connectionStatusSchema = z.object(connectionStatusShape);

// Tool implementation
export async function connectionStatus(
  rawParams: any
): McpToolResponse {
  try {
    // Validate and parse parameters
    const params = connectionStatusSchema.parse(rawParams);
    
    debug("Connection status tool called with retry: %s", params.retry);
    
    // If retry is requested, attempt to reconnect
    if (params.retry) {
      debug("Attempting connection retry...");
      const retrySuccess = await retryConnection();
      const status = getConnectionStatus();
      
      return createMcpSuccessResponse({
        action: "retry_attempted",
        connection_status: status.status,
        retry_successful: retrySuccess,
        error: status.error,
        last_attempt: status.lastAttempt,
        message: retrySuccess 
          ? "Database connection retry successful" 
          : `Database connection retry failed: ${status.error}`,
        troubleshooting: retrySuccess ? null : {
          common_issues: [
            "Check if PostgreSQL server is running",
            "Verify DATABASE_URL environment variable is correct", 
            "Ensure database credentials are valid",
            "Check network connectivity to database server",
            "Verify firewall settings allow database connections"
          ],
          next_steps: [
            "Review your database configuration in .env file",
            "Test connection manually with psql or database client",
            "Check database server logs for connection errors",
            "Use connection-status tool with retry: true to test again"
          ]
        }
      });
    }
    
    // Return current status without retry attempt
    const status = getConnectionStatus();
    
    return createMcpSuccessResponse({
      connection_status: status.status,
      error: status.error,
      last_attempt: status.lastAttempt,
      message: status.status === 'connected' 
        ? "Database connection is healthy" 
        : status.status === 'failed'
        ? `Database connection failed: ${status.error}`
        : "Database connection status unknown - no connection attempt made yet",
      retry_available: true,
      troubleshooting: status.status === 'failed' ? {
        common_issues: [
          "Check if PostgreSQL server is running",
          "Verify DATABASE_URL environment variable is correct", 
          "Ensure database credentials are valid",
          "Check network connectivity to database server",
          "Verify firewall settings allow database connections"
        ],
        next_steps: [
          "Review your database configuration in .env file",
          "Test connection manually with psql or database client", 
          "Check database server logs for connection errors",
          "Use connection-status tool with retry: true to attempt reconnection"
        ]
      } : null
    });
    
  } catch (error) {
    debug("Error in connection status tool: %o", error);
    return createMcpErrorResponse("check connection status", error);
  }
}