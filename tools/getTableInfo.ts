import { z, ZodRawShape } from "zod";
import {
  McpToolResponse,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  createDatabaseUnavailableResponse,
  executePostgresQuery,
  sanitizeIdentifier,
  getConnectionStatus,
  debug,
} from "./utils.js";

// Zod schema for input validation
export const getTableInfoShape: ZodRawShape = {
  table: z.string().min(1, "Table name is required"),
  schema_name: z.string().optional().default("public"),
  include_statistics: z.boolean().optional().default(true),
};

export const getTableInfoSchema = z.object(getTableInfoShape);

interface TableStatistics {
  estimated_row_count: number;
  table_size_bytes: number;
  table_size_pretty: string;
  index_size_bytes: number;
  index_size_pretty: string;
  total_size_bytes: number;
  total_size_pretty: string;
}

// Tool implementation
export async function getTableInfo(
  rawParams: any
): McpToolResponse {
  try {
    // Validate and parse parameters
    const params = getTableInfoSchema.parse(rawParams);
    
    // Check database connection status
    const connectionStatus = getConnectionStatus();
    if (connectionStatus.status !== 'connected') {
      return createDatabaseUnavailableResponse("get table information");
    }
    
    const { table, schema_name, include_statistics } = params;

    // Validate identifiers
    const sanitizedTable = sanitizeIdentifier(table);
    const sanitizedSchema = sanitizeIdentifier(schema_name);

    // Get basic table information
    const tableInfoQuery = `
      SELECT 
        t.table_name,
        t.table_schema,
        t.table_type,
        obj_description(c.oid) as table_comment
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
      WHERE t.table_schema = $1 AND t.table_name = $2
    `;

    const tableInfo = await executePostgresQuery(tableInfoQuery, [sanitizedSchema, sanitizedTable]);
    
    if (tableInfo.length === 0) {
      throw new Error(`Table ${sanitizedSchema}.${sanitizedTable} not found`);
    }

    // Get detailed column information
    const columnsQuery = `
      SELECT 
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.ordinal_position,
        col_description(pgc.oid, c.ordinal_position) as column_comment
      FROM information_schema.columns c
      LEFT JOIN pg_class pgc ON pgc.relname = c.table_name
      LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = c.table_schema
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
    `;

    const columns = await executePostgresQuery(columnsQuery, [sanitizedSchema, sanitizedTable]);

    // Get constraints
    const constraintsQuery = `
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.match_option,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      LEFT JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2
      ORDER BY tc.constraint_type, tc.constraint_name
    `;

    const constraints = await executePostgresQuery(constraintsQuery, [sanitizedSchema, sanitizedTable]);

    // Get indexes
    const indexesQuery = `
      SELECT 
        i.relname as index_name,
        a.attname as column_name,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary,
        am.amname as index_type
      FROM pg_class i
      JOIN pg_index ix ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      JOIN pg_am am ON i.relam = am.oid
      WHERE n.nspname = $1 AND t.relname = $2
      ORDER BY i.relname, a.attnum
    `;

    const indexes = await executePostgresQuery(indexesQuery, [sanitizedSchema, sanitizedTable]);

    let statistics: TableStatistics | undefined;

    // Get table statistics if requested
    if (include_statistics) {
      const statsQuery = `
        SELECT 
          schemaname,
          tablename,
          attname,
          n_distinct,
          correlation
        FROM pg_stats 
        WHERE schemaname = $1 AND tablename = $2
      `;

      const sizeQuery = `
        SELECT 
          pg_stat_get_live_tuples(c.oid) as estimated_row_count,
          pg_total_relation_size(c.oid) as total_size_bytes,
          pg_size_pretty(pg_total_relation_size(c.oid)) as total_size_pretty,
          pg_relation_size(c.oid) as table_size_bytes,
          pg_size_pretty(pg_relation_size(c.oid)) as table_size_pretty,
          pg_total_relation_size(c.oid) - pg_relation_size(c.oid) as index_size_bytes,
          pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) as index_size_pretty
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
      `;

      try {
        const sizeResult = await executePostgresQuery(sizeQuery, [sanitizedSchema, sanitizedTable]);
        if (sizeResult.length > 0) {
          const rawStats = sizeResult[0];
          statistics = {
            estimated_row_count: parseInt(rawStats.estimated_row_count) || 0,
            table_size_bytes: parseInt(rawStats.table_size_bytes) || 0,
            table_size_pretty: rawStats.table_size_pretty,
            index_size_bytes: parseInt(rawStats.index_size_bytes) || 0,
            index_size_pretty: rawStats.index_size_pretty,
            total_size_bytes: parseInt(rawStats.total_size_bytes) || 0,
            total_size_pretty: rawStats.total_size_pretty,
          };
        }
      } catch (error) {
        debug("Failed to get table statistics: %o", error);
      }
    }

    const response = {
      table: tableInfo[0],
      columns: columns,
      constraints: constraints,
      indexes: indexes,
      ...(statistics && { statistics }),
      generated_at: new Date().toISOString(),
    };

    return createMcpSuccessResponse(response);

  } catch (error) {
    return createMcpErrorResponse("get table info", error);
  }
}