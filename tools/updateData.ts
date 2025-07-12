import { z, ZodRawShape } from "zod";
import {
  McpToolResponse,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  executePostgresQuery,
  sanitizeIdentifier,
  debug,
} from "./utils.js";

// Zod schema for input validation
export const updateDataShape: ZodRawShape = {
  table: z.string().min(1, "Table name is required"),
  data: z.record(z.any()),
  where: z.record(z.any()),
  returning: z.array(z.string()).optional().default(["*"]),
};

export const updateDataSchema = z.object(updateDataShape);

// Tool implementation
export async function updateData(
  params: z.infer<typeof updateDataSchema>
): McpToolResponse {
  try {
    const { table, data, where, returning } = params;

    // Validate table name
    const sanitizedTable = sanitizeIdentifier(table);

    // Validate that we have data to update
    if (!data || Object.keys(data).length === 0) {
      throw new Error("No data provided for update");
    }

    // Validate that we have WHERE conditions (safety check)
    if (!where || Object.keys(where).length === 0) {
      throw new Error("WHERE clause is required for UPDATE operations for safety");
    }

    // Build SET clause
    const setClauses: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    for (const [column, value] of Object.entries(data)) {
      const sanitizedColumn = sanitizeIdentifier(column);
      setClauses.push(`${sanitizedColumn} = $${paramIndex}`);
      queryParams.push(value);
      paramIndex++;
    }

    // Build WHERE clause
    const whereConditions: string[] = [];
    
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

    // Build UPDATE query
    let updateQuery = `
      UPDATE ${sanitizedTable}
      SET ${setClauses.join(", ")}
      WHERE ${whereConditions.join(" AND ")}
    `;

    // Add RETURNING clause
    if (returning && returning.length > 0) {
      const sanitizedReturning = returning.map((col: string) => 
        col === "*" ? "*" : sanitizeIdentifier(col)
      );
      updateQuery += ` RETURNING ${sanitizedReturning.join(", ")}`;
    }

    debug("Executing update query");
    const results = await executePostgresQuery(updateQuery, queryParams);

    const response = {
      table: sanitizedTable,
      updated_count: results.length,
      data: results,
      updated_at: new Date().toISOString(),
    };

    return createMcpSuccessResponse(response);

  } catch (error) {
    return createMcpErrorResponse("update data", error);
  }
}