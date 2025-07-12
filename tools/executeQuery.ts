import { z, ZodRawShape } from "zod";
import {
  McpToolResponse,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  executePostgresQuery,
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
  params: z.infer<typeof executeQuerySchema>
): McpToolResponse {
  try {
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
      /delete\s+from.*without.*where/i, // This is a simplified check
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        throw new Error(`Potentially dangerous SQL operation detected. Query rejected for safety.`);
      }
    }

    // Warn about DELETE/UPDATE without WHERE clause
    if ((trimmedQuery.includes('delete from') || trimmedQuery.includes('update ')) && 
        !trimmedQuery.includes('where')) {
      debug("Warning: DELETE/UPDATE without WHERE clause detected");
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
      query_type: queryType,
      execution_time_ms: executionTime,
      row_count: results.length,
      data: results,
      ...(executionPlan && { execution_plan: executionPlan }),
      executed_at: new Date().toISOString(),
    };

    debug("Query executed successfully: %s rows in %dms", results.length, executionTime);
    return createMcpSuccessResponse(response);

  } catch (error) {
    return createMcpErrorResponse("execute query", error);
  }
}