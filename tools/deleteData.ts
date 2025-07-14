import { z, ZodRawShape } from "zod";
import {
  McpToolResponse,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  createDatabaseUnavailableResponse,
  executePostgresQuery,
  executePostgresModification,
  sanitizeIdentifier,
  getConnectionStatus,
  debug,
} from "./utils.js";

// Zod schema for input validation
export const deleteDataShape: ZodRawShape = {
  table: z.string().min(1, "Table name is required"),
  where: z.record(z.any()),
  confirm_delete: z.boolean().optional().default(false),
  returning: z.array(z.string()).optional(),
};

export const deleteDataSchema = z.object(deleteDataShape);

// Tool implementation
export async function deleteData(
  rawParams: any
): McpToolResponse {
  try {
    // Validate and parse parameters
    const params = deleteDataSchema.parse(rawParams);
    // Check database connection status
    const connectionStatus = getConnectionStatus();
    if (connectionStatus.status !== 'connected') {
      return createDatabaseUnavailableResponse("delete data");
    }
    
    const { table, where, confirm_delete, returning } = params;

    // Validate table name
    const sanitizedTable = sanitizeIdentifier(table);

    // Validate that we have WHERE conditions (safety check)
    if (!where || Object.keys(where).length === 0) {
      throw new Error("WHERE clause is required for DELETE operations for safety");
    }

    // Build WHERE clause
    const whereConditions: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    for (const [column, value] of Object.entries(where)) {
      const sanitizedColumn = sanitizeIdentifier(column);
      
      if (value === null) {
        whereConditions.push(`${sanitizedColumn} IS NULL`);
      } else if (Array.isArray(value)) {
        // Handle IN operator for arrays
        const placeholders = value.map(() => `$${paramIndex++}`).join(", ");
        whereConditions.push(`${sanitizedColumn} IN (${placeholders})`);
        queryParams.push(...value);
      } else if (typeof value === 'string' && value.includes('%')) {
        // Handle LIKE operator for strings with wildcards
        whereConditions.push(`${sanitizedColumn} LIKE $${paramIndex}`);
        queryParams.push(value);
        paramIndex++;
      } else {
        // Handle equality
        whereConditions.push(`${sanitizedColumn} = $${paramIndex}`);
        queryParams.push(value);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.join(" AND ");

    // Safety check: estimate impact before deletion
    if (!confirm_delete) {
      const countQuery = `SELECT COUNT(*) as count FROM ${sanitizedTable} WHERE ${whereClause}`;
      const countResult = await executePostgresQuery(countQuery, queryParams);
      const affectedRows = parseInt(countResult[0].count);

      if (affectedRows > 100) {
        throw new Error(
          `This operation would delete ${affectedRows} rows. ` +
          `If you're sure you want to proceed, set confirm_delete to true.`
        );
      }

      if (affectedRows === 0) {
        return createMcpSuccessResponse({
          table: sanitizedTable,
          deleted_count: 0,
          message: "No rows match the WHERE conditions",
          deleted_at: new Date().toISOString(),
        });
      }
    }

    // Build DELETE query
    let deleteQuery = `DELETE FROM ${sanitizedTable} WHERE ${whereClause}`;

    // Add RETURNING clause if specified
    let hasEmptyReturning = false;
    if (returning !== undefined) {
      if (returning.length > 0) {
        const sanitizedReturning = returning.map((col: string) => 
          col === "*" ? "*" : sanitizeIdentifier(col)
        );
        deleteQuery += ` RETURNING ${sanitizedReturning.join(", ")}`;
      } else {
        hasEmptyReturning = true;
      }
    }

    const result = await executePostgresModification(deleteQuery, queryParams);

    const response = {
      table: sanitizedTable,
      deleted_count: result.affectedCount,
      ...(returning !== undefined && { 
        data: hasEmptyReturning 
          ? Array(result.affectedCount).fill({}) 
          : result.rows 
      }),
      deleted_at: new Date().toISOString(),
    };

    return createMcpSuccessResponse(response);

  } catch (error) {
    return createMcpErrorResponse("delete data", error);
  }
}