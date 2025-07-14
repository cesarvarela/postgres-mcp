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
export const getSchemaShape: ZodRawShape = {
  schema_name: z.string().optional().default("public"),
  table_pattern: z.string().optional(),
  include_columns: z.boolean().optional().default(true),
  include_constraints: z.boolean().optional().default(false),
};

export const getSchemaSchema = z.object(getSchemaShape);

interface TableInfo {
  table_name: string;
  table_schema: string;
  table_type: string;
  columns?: ColumnInfo[];
  constraints?: ConstraintInfo[];
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
  column_name: string;
  foreign_table_name?: string;
  foreign_column_name?: string;
}

// Tool implementation
export async function getSchema(
  rawParams: any
): McpToolResponse {
  try {
    // Validate and parse parameters
    const params = getSchemaSchema.parse(rawParams);
    
    // Check database connection status
    const connectionStatus = getConnectionStatus();
    if (connectionStatus.status !== 'connected') {
      return createDatabaseUnavailableResponse("get database schema");
    }
    
    const { schema_name, table_pattern, include_columns, include_constraints } = params;

    // Base query for tables
    let tablesQuery = `
      SELECT 
        table_name,
        table_schema,
        table_type
      FROM information_schema.tables
      WHERE table_schema = $1
    `;
    
    const queryParams: any[] = [schema_name];
    let paramIndex = 2;

    // Add table pattern filter if provided
    if (table_pattern) {
      tablesQuery += ` AND table_name LIKE $${paramIndex}`;
      queryParams.push(table_pattern);
      paramIndex++;
    }

    tablesQuery += ` ORDER BY table_name`;

    debug("Fetching schema information for schema: %s", schema_name);
    const tables = await executePostgresQuery<TableInfo>(tablesQuery, queryParams);

    // Initialize columns and constraints properties for all tables
    tables.forEach(table => {
      table.columns = [];
      table.constraints = [];
    });

    // Enhance tables with column information if requested
    if (include_columns && tables.length > 0) {
      const columnsQuery = `
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale,
          ordinal_position
        FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position
      `;

      const columns = await executePostgresQuery<ColumnInfo & { table_name: string; ordinal_position: number }>(
        columnsQuery, 
        [schema_name]
      );

      // Group columns by table
      const columnsByTable = new Map<string, ColumnInfo[]>();
      columns.forEach(col => {
        if (!columnsByTable.has(col.table_name)) {
          columnsByTable.set(col.table_name, []);
        }
        const { table_name, ordinal_position, ...columnInfo } = col;
        columnsByTable.get(col.table_name)!.push(columnInfo);
      });

      // Add columns to tables
      tables.forEach(table => {
        table.columns = columnsByTable.get(table.table_name) || [];
      });
    }

    // Enhance tables with constraint information if requested
    if (include_constraints && tables.length > 0) {
      const constraintsQuery = `
        SELECT 
          tc.table_name,
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        LEFT JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.table_schema = $1
        ORDER BY tc.table_name, tc.constraint_name
      `;

      const constraints = await executePostgresQuery<ConstraintInfo & { table_name: string }>(
        constraintsQuery, 
        [schema_name]
      );

      // Group constraints by table
      const constraintsByTable = new Map<string, ConstraintInfo[]>();
      constraints.forEach(constraint => {
        if (!constraintsByTable.has(constraint.table_name)) {
          constraintsByTable.set(constraint.table_name, []);
        }
        const { table_name, ...constraintInfo } = constraint;
        constraintsByTable.get(constraint.table_name)!.push(constraintInfo);
      });

      // Add constraints to tables
      tables.forEach(table => {
        table.constraints = constraintsByTable.get(table.table_name) || [];
      });
    }

    const response = {
      schema: schema_name,
      table_count: tables.length,
      tables: tables,
      generated_at: new Date().toISOString(),
    };

    return createMcpSuccessResponse(response);

  } catch (error) {
    return createMcpErrorResponse("get schema", error);
  }
}