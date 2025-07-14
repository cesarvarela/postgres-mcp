import { z, ZodRawShape } from "zod";
import {
  McpToolResponse,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  createDatabaseUnavailableResponse,
  executePostgresQuery,
  getConnectionStatus,
  debug,
} from "./utils.js";

// Zod schema for input validation
export const executeQueryShape: ZodRawShape = {
  query: z.string().min(1, "SQL query is required"),
  params: z.array(z.any()).optional().default([]),
  explain: z.boolean().optional().default(false),
};

export const executeQuerySchema = z.object(executeQueryShape);

// Tool implementation
export async function executeQuery(
  rawParams: any
): McpToolResponse {
  try {
    // Validate and parse parameters
    const params = executeQuerySchema.parse(rawParams);
    
    // Check database connection status
    const connectionStatus = getConnectionStatus();
    if (connectionStatus.status !== 'connected') {
      return createDatabaseUnavailableResponse("execute SQL query");
    }
    
    const { query, params: queryParams, explain } = params;

    // Basic security checks
    const trimmedQuery = query.trim().toLowerCase();
    
    // Prevent dangerous operations
    const dangerousPatterns = [
      /drop\s+table/i,
      /drop\s+database/i,
      /drop\s+schema/i,
      /truncate\s+table/i,
      /alter\s+table.*drop/i,
      /alter\s+table.*add/i, // Prevent adding columns
      /create\s+table/i, // Prevent creating tables
      /insert\s+into/i, // Prevent data insertion for security
    ];

    // Check for DELETE/UPDATE without WHERE clause
    if (trimmedQuery.startsWith('delete from') && !trimmedQuery.includes(' where ')) {
      throw new Error(`DELETE without WHERE clause is not allowed for safety.`);
    }
    if (trimmedQuery.startsWith('update ') && trimmedQuery.includes(' set ') && !trimmedQuery.includes(' where ')) {
      throw new Error(`UPDATE without WHERE clause is not allowed for safety.`);
    }

    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        throw new Error(`Potentially dangerous SQL operation detected. Query rejected for safety.`);
      }
    }


    const startTime = Date.now();
    let results: any[];
    let executionPlan: any[] | undefined;

    // Execute EXPLAIN if requested
    if (explain) {
      const explainQuery = `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) ${query}`;
      try {
        executionPlan = await executePostgresQuery(explainQuery, queryParams);
      } catch (explainError) {
        debug("Failed to get execution plan: %o", explainError);
        // Continue with normal execution even if EXPLAIN fails
      }
    }

    // Execute the main query
    results = await executePostgresQuery(query, queryParams);
    const executionTime = Date.now() - startTime;

    // Convert numeric strings to numbers for better usability
    results = results.map(row => {
      const convertedRow: any = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) {
          // Only convert if it's a proper numeric string
          const numValue = Number(value);
          if (Number.isInteger(numValue) || !Number.isNaN(numValue)) {
            convertedRow[key] = numValue;
          } else {
            convertedRow[key] = value;
          }
        } else {
          convertedRow[key] = value;
        }
      }
      return convertedRow;
    });

    // Determine query type
    let queryType = "SELECT";
    if (trimmedQuery.startsWith("insert")) {
      queryType = "INSERT";
    } else if (trimmedQuery.startsWith("update")) {
      queryType = "UPDATE";
    } else if (trimmedQuery.startsWith("delete")) {
      queryType = "DELETE";
    } else if (trimmedQuery.startsWith("create")) {
      queryType = "CREATE";
    } else if (trimmedQuery.startsWith("alter")) {
      queryType = "ALTER";
    }

    const response = {
      success: true,
      query_type: queryType,
      execution_time_ms: executionTime,
      row_count: results.length,
      data: results,
      results: results, // Add for backward compatibility with tests
      ...(executionPlan && { execution_plan: executionPlan }),
      executed_at: new Date().toISOString(),
    };

    debug("Query executed successfully: %s rows in %dms", results.length, executionTime);
    return createMcpSuccessResponse(response);

  } catch (error) {
    return createMcpErrorResponse("execute query", error);
  }
}