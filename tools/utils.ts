import dotenv from "dotenv";
import { z } from "zod";
import { Pool, PoolClient } from "pg";
import Debug from "debug";

dotenv.config();

export const debug = Debug("postgres-mcp");

// Connection state management
export type ConnectionStatus = 'connected' | 'failed' | 'unknown';

let connectionStatus: ConnectionStatus = 'unknown';
let connectionError: string | null = null;
let lastConnectionAttempt: Date | null = null;

// Database connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT) : undefined,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: process.env.MAX_CONNECTIONS ? parseInt(process.env.MAX_CONNECTIONS) : 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// MCP response types
export type McpToolResponse = Promise<{
  content: Array<{
    type: "text";
    text: string;
  }>;
}>;

// Database query function with error handling
export async function executePostgresQuery<T = any>(
  query: string, 
  params: any[] = []
): Promise<T[]> {
  const client: PoolClient = await pool.connect();
  
  try {
    debug("Executing query: %s with params: %O", query, params);
    
    // Set query timeout if configured
    if (process.env.QUERY_TIMEOUT) {
      await client.query(`SET statement_timeout = ${process.env.QUERY_TIMEOUT}`);
    }
    
    const result = await client.query(query, params);
    debug("Query completed successfully, returned %d rows", result.rows.length);
    return result.rows;
  } catch (error: any) {
    debug("Database query error: %o", error);
    throw new Error(`Database query failed: ${error.message}`);
  } finally {
    client.release();
  }
}

// Database modification query function that returns both rows and affected count
export async function executePostgresModification<T = any>(
  query: string, 
  params: any[] = []
): Promise<{ rows: T[]; affectedCount: number }> {
  const client: PoolClient = await pool.connect();
  
  try {
    debug("Executing modification query: %s with params: %O", query, params);
    
    // Set query timeout if configured
    if (process.env.QUERY_TIMEOUT) {
      await client.query(`SET statement_timeout = ${process.env.QUERY_TIMEOUT}`);
    }
    
    const result = await client.query(query, params);
    debug("Modification completed successfully, affected %d rows, returned %d rows", result.rowCount, result.rows.length);
    return {
      rows: result.rows,
      affectedCount: result.rowCount || 0
    };
  } catch (error: any) {
    debug("Database modification error: %o", error);
    throw new Error(`Database modification failed: ${error.message}`);
  } finally {
    client.release();
  }
}

// Response creators
export function createMcpSuccessResponse(data: any): McpToolResponse {
  return Promise.resolve({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  });
}

export function createMcpErrorResponse(
  operation: string, 
  error: unknown
): McpToolResponse {
  const errorMessage = error instanceof Error ? error.message : String(error);
  debug("Error in %s: %s", operation, errorMessage);
  
  return Promise.resolve({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: `Failed to ${operation}`,
          message: errorMessage,
          timestamp: new Date().toISOString(),
        }, null, 2),
      },
    ],
  });
}

export function createDatabaseUnavailableResponse(operation: string): McpToolResponse {
  const status = getConnectionStatus();
  
  return Promise.resolve({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: `Cannot ${operation}`,
          message: "Database connection is not available",
          connection_status: status.status,
          connection_error: status.error,
          last_attempt: status.lastAttempt,
          next_steps: [
            "Use the 'connection-status' tool to check the connection details",
            "Use 'connection-status' with retry: true to attempt reconnection",
            "Verify your database configuration in .env file",
            "Ensure PostgreSQL server is running and accessible"
          ],
          timestamp: new Date().toISOString(),
        }, null, 2),
      },
    ],
  });
}

// Common schemas
export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const sortSchema = z.object({
  column: z.string().min(1),
  direction: z.enum(["ASC", "DESC"]).optional().default("ASC"),
});

// Table and column name validation
export function validateIdentifier(identifier: string): boolean {
  // PostgreSQL identifier rules: start with letter or underscore, 
  // followed by letters, digits, underscores, or dollar signs
  const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
  return identifierRegex.test(identifier) && identifier.length <= 63;
}

export function sanitizeIdentifier(identifier: string): string {
  if (!validateIdentifier(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  return identifier;
}

// Close database pool gracefully
export async function closePool(): Promise<void> {
  await pool.end();
  debug("Database pool closed");
}

// Connection status management functions
export function getConnectionStatus(): {
  status: ConnectionStatus;
  error: string | null;
  lastAttempt: Date | null;
} {
  return {
    status: connectionStatus,
    error: connectionError,
    lastAttempt: lastConnectionAttempt,
  };
}

export async function retryConnection(): Promise<boolean> {
  debug("Attempting to retry database connection...");
  lastConnectionAttempt = new Date();
  
  try {
    const result = await executePostgresQuery("SELECT 1 as test");
    const success = result.length === 1 && result[0].test === 1;
    
    if (success) {
      connectionStatus = 'connected';
      connectionError = null;
      debug("Connection retry successful");
      return true;
    } else {
      connectionStatus = 'failed';
      connectionError = "Connection test query returned unexpected result";
      debug("Connection retry failed: unexpected result");
      return false;
    }
  } catch (error) {
    connectionStatus = 'failed';
    connectionError = error instanceof Error ? error.message : String(error);
    debug("Connection retry failed: %o", error);
    return false;
  }
}

// Test database connection
export async function testConnection(): Promise<boolean> {
  lastConnectionAttempt = new Date();
  
  try {
    const result = await executePostgresQuery("SELECT 1 as test");
    const success = result.length === 1 && result[0].test === 1;
    
    if (success) {
      connectionStatus = 'connected';
      connectionError = null;
      debug("Database connection test successful");
      return true;
    } else {
      connectionStatus = 'failed';
      connectionError = "Connection test query returned unexpected result";
      debug("Connection test failed: unexpected result");
      return false;
    }
  } catch (error) {
    connectionStatus = 'failed';
    connectionError = error instanceof Error ? error.message : String(error);
    debug("Connection test failed: %o", error);
    return false;
  }
}