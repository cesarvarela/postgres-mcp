import { z, ZodRawShape } from "zod";
import {
  McpToolResponse,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  createDatabaseUnavailableResponse,
  executePostgresModification,
  sanitizeIdentifier,
  getConnectionStatus,
  debug,
} from "./utils.js";

// Zod schema for input validation
export const insertDataShape: ZodRawShape = {
  table: z.string().min(1, "Table name is required"),
  data: z.union([
    z.record(z.any()), // Single record
    z.array(z.record(z.any())), // Multiple records
  ]),
  on_conflict: z.enum(["error", "ignore", "update"]).optional().default("error"),
  conflict_columns: z.array(z.string()).optional(),
  returning: z.array(z.string()).optional().default(["*"]),
};

export const insertDataSchema = z.object(insertDataShape);

// Tool implementation
export async function insertData(
  rawParams: any
): McpToolResponse {
  try {
    // Validate and parse parameters
    const params = insertDataSchema.parse(rawParams);
    
    // Check database connection status
    const connectionStatus = getConnectionStatus();
    if (connectionStatus.status !== 'connected') {
      return createDatabaseUnavailableResponse("insert data");
    }
    
    const { table, data, on_conflict, conflict_columns, returning } = params;

    // Validate table name
    const sanitizedTable = sanitizeIdentifier(table);

    // Normalize data to array format
    const records = Array.isArray(data) ? data : [data];
    
    if (records.length === 0) {
      throw new Error("No data provided for insertion");
    }

    // Get column names from the first record
    const firstRecord = records[0];
    const columns = Object.keys(firstRecord);
    
    if (columns.length === 0) {
      throw new Error("No columns found in data");
    }

    // Validate column names
    const sanitizedColumns = columns.map((col: string) => sanitizeIdentifier(col));

    // Validate that all records have the same columns
    for (let i = 1; i < records.length; i++) {
      const recordColumns = Object.keys(records[i]);
      if (recordColumns.length !== columns.length || 
          !recordColumns.every(col => columns.includes(col))) {
        throw new Error(`Record ${i + 1} has different columns than the first record`);
      }
    }

    // Build VALUES clause
    const valuesClauses: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    for (const record of records) {
      const values: string[] = [];
      for (const column of columns) {
        values.push(`$${paramIndex}`);
        queryParams.push(record[column]);
        paramIndex++;
      }
      valuesClauses.push(`(${values.join(", ")})`);
    }

    // Build INSERT query
    let insertQuery = `
      INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(", ")})
      VALUES ${valuesClauses.join(", ")}
    `;

    // Handle conflict resolution
    if (on_conflict !== "error") {
      insertQuery += " ON CONFLICT";
      
      if (conflict_columns && conflict_columns.length > 0) {
        const sanitizedConflictColumns = conflict_columns.map((col: string) => sanitizeIdentifier(col));
        insertQuery += ` (${sanitizedConflictColumns.join(", ")})`;
      }

      if (on_conflict === "ignore") {
        insertQuery += " DO NOTHING";
      } else if (on_conflict === "update") {
        // Build UPDATE SET clause for upsert
        const updateClauses = sanitizedColumns
          .filter(col => !conflict_columns?.includes(col)) // Don't update conflict columns
          .map(col => `${col} = EXCLUDED.${col}`);
        
        if (updateClauses.length > 0) {
          insertQuery += ` DO UPDATE SET ${updateClauses.join(", ")}`;
        } else {
          insertQuery += " DO NOTHING"; // No columns to update
        }
      }
    }

    // Add RETURNING clause
    let hasEmptyReturning = false;
    if (returning.length > 0) {
      const sanitizedReturning = returning.map((col: string) => 
        col === "*" ? "*" : sanitizeIdentifier(col)
      );
      insertQuery += ` RETURNING ${sanitizedReturning.join(", ")}`;
    } else {
      // Empty returning array - we need to track this case
      hasEmptyReturning = true;
    }

    debug("Executing insert query with %d records", records.length);
    const result = await executePostgresModification(insertQuery, queryParams);

    const response = {
      table: sanitizedTable,
      inserted_count: result.affectedCount,
      records_provided: records.length,
      on_conflict_action: on_conflict,
      data: hasEmptyReturning 
        ? Array(result.affectedCount).fill({}) 
        : result.rows,
      inserted_at: new Date().toISOString(),
    };

    return createMcpSuccessResponse(response);

  } catch (error) {
    return createMcpErrorResponse("insert data", error);
  }
}