import { z, ZodRawShape } from "zod";
import {
  McpToolResponse,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  createDatabaseUnavailableResponse,
  executePostgresQuery,
  paginationSchema,
  sortSchema,
  sanitizeIdentifier,
  getConnectionStatus,
  debug,
} from "./utils.js";

// Zod schema for input validation
export const queryTableShape: ZodRawShape = {
  table: z.string().min(1, "Table name is required"),
  columns: z.array(z.string().min(1)).optional(),
  where: z.record(z.any()).optional(),
  pagination: paginationSchema.optional(),
  sort: sortSchema.optional(),
};

export const queryTableSchema = z.object(queryTableShape);

// Tool implementation
export async function queryTable(
  rawParams: any
): McpToolResponse {
  try {
    // Validate and parse parameters
    const params = queryTableSchema.parse(rawParams);
    // Check database connection status
    const connectionStatus = getConnectionStatus();
    if (connectionStatus.status !== 'connected') {
      return createDatabaseUnavailableResponse("query table data");
    }
    
    const { table, columns, where, pagination, sort } = params;

    // Validate table name
    const sanitizedTable = sanitizeIdentifier(table);

    // Build SELECT clause
    let selectClause = "*";
    if (columns?.length) {
      const sanitizedColumns = columns.map((col: string) => sanitizeIdentifier(col));
      selectClause = sanitizedColumns.join(", ");
    }

    // Build WHERE clause
    let whereClause = "";
    let queryParams: any[] = [];
    let paramIndex = 1;

    if (where && Object.keys(where).length > 0) {
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
      
      whereClause = `WHERE ${whereConditions.join(" AND ")}`;
    }

    // Build ORDER BY clause
    let orderClause = "";
    if (sort) {
      const sanitizedSortColumn = sanitizeIdentifier(sort.column);
      const direction = sort.direction || 'ASC';
      orderClause = `ORDER BY ${sanitizedSortColumn} ${direction}`;
    }

    // Build LIMIT/OFFSET clause
    let limitClause = "";
    if (pagination) {
      limitClause = `LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(pagination.limit, pagination.offset);
    }

    // Construct final query
    const query = `
      SELECT ${selectClause}
      FROM ${sanitizedTable}
      ${whereClause}
      ${orderClause}
      ${limitClause}
    `.trim().replace(/\s+/g, ' ');

    debug("Executing table query: %s", query);
    const results = await executePostgresQuery(query, queryParams);
    
    // Get total count for pagination info
    let totalCount: number | undefined;
    if (pagination) {
      const countQuery = `
        SELECT COUNT(*) as total
        FROM ${sanitizedTable}
        ${whereClause}
      `.trim().replace(/\s+/g, ' ');
      
      const countParams = queryParams.slice(0, queryParams.length - 2); // Remove limit/offset params
      const countResult = await executePostgresQuery(countQuery, countParams);
      totalCount = parseInt(countResult[0].total);
    }
    
    const response = {
      table: sanitizedTable,
      count: results.length,
      data: results,
      ...(totalCount !== undefined && {
        pagination: {
          total: totalCount,
          limit: pagination!.limit,
          offset: pagination!.offset,
          hasMore: pagination!.offset + pagination!.limit < totalCount,
        }
      }),
    };

    return createMcpSuccessResponse(response);

  } catch (error) {
    return createMcpErrorResponse("query table", error);
  }
}