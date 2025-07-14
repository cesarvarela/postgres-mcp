# PostgreSQL MCP Server

A TypeScript-based Model Context Protocol (MCP) server that provides AI assistants with secure, structured access to PostgreSQL databases.

## Features

- **Safe Database Operations**: All queries use parameterized statements to prevent SQL injection
- **Comprehensive Tools**: Query, insert, update, delete data with full schema introspection
- **Flexible Querying**: Support for filtering, pagination, sorting, and complex WHERE conditions
- **Schema Discovery**: Get detailed information about tables, columns, constraints, and indexes
- **Connection Pooling**: Efficient database connection management
- **Error Handling**: Comprehensive error reporting without exposing sensitive information
- **Safety Checks**: Required WHERE clauses for updates/deletes, confirmation for large operations

## Tools Available

### `query-table`
Query data from a specific table with filtering, pagination, and sorting.

**Parameters:**
- `table` (string, required): Table name to query
- `columns` (string[], optional): Specific columns to select (default: all)
- `where` (object, optional): WHERE conditions (supports equality, arrays for IN, wildcards for LIKE)
- `pagination` (object, optional): `{limit: number, offset: number}`
- `sort` (object, optional): `{column: string, direction: "ASC"|"DESC"}`

### `get-schema`
Get database schema information including tables, columns, and constraints.

**Parameters:**
- `schema_name` (string, optional): Schema to inspect (default: "public")
- `table_pattern` (string, optional): LIKE pattern for table names
- `include_columns` (boolean, optional): Include column details (default: true)
- `include_constraints` (boolean, optional): Include constraint details (default: false)

### `execute-query`
Execute a parameterized SQL query with safety checks.

**Parameters:**
- `query` (string, required): SQL query with parameter placeholders ($1, $2, etc.)
- `params` (any[], optional): Parameters for the query
- `explain` (boolean, optional): Include execution plan (default: false)

### `insert-data`
Insert new records into a table.

**Parameters:**
- `table` (string, required): Target table name
- `data` (object|object[], required): Data to insert (single record or array)
- `on_conflict` (string, optional): Conflict resolution: "error", "ignore", "update" (default: "error")
- `conflict_columns` (string[], optional): Columns to check for conflicts
- `returning` (string[], optional): Columns to return (default: ["*"])

### `update-data`
Update existing records in a table.

**Parameters:**
- `table` (string, required): Target table name
- `data` (object, required): Data to update
- `where` (object, required): WHERE conditions (required for safety)
- `returning` (string[], optional): Columns to return (default: ["*"])

### `delete-data`
Delete records from a table.

**Parameters:**
- `table` (string, required): Target table name
- `where` (object, required): WHERE conditions (required for safety)
- `confirm_delete` (boolean, optional): Bypass confirmation for large deletes
- `returning` (string[], optional): Columns to return from deleted records

### `get-table-info`
Get detailed information about a specific table.

**Parameters:**
- `table` (string, required): Table name
- `schema_name` (string, optional): Schema name (default: "public")
- `include_statistics` (boolean, optional): Include size and row count stats (default: true)

### `connection-status`
Check database connection status, view error details, and retry connection.

**Parameters:**
- `retry` (boolean, optional): Attempt to reconnect if connection is currently failed (default: false)

**Returns:**
- Current connection status ("connected", "failed", or "unknown")
- Error details if connection failed
- Last connection attempt timestamp
- Troubleshooting information for failed connections
- Result of retry attempt if retry was requested

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Set your PostgreSQL connection details:

```env
# Required: PostgreSQL connection string
DATABASE_URL=postgresql://username:password@localhost:5432/database_name

# Optional: Individual connection parameters
# POSTGRES_HOST=localhost
# POSTGRES_PORT=5432
# POSTGRES_DB=database_name
# POSTGRES_USER=username
# POSTGRES_PASSWORD=password

# Optional: Environment and debugging
NODE_ENV=development
DEBUG=postgres-mcp*

# Optional: Connection pool settings
MAX_CONNECTIONS=20
QUERY_TIMEOUT=30000
```

## Usage

### Development

```bash
# Start in development mode with auto-reload
npm run dev

# Or start normally
npm start
```

### Production

```bash
# Build the project
npm run build

# Run the built version
node dist/index.js
```

### As an MCP Server

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["/path/to/postgres-mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://username:password@localhost:5432/database_name"
      }
    }
  }
}
```

## Security Considerations

1. **Parameterized Queries**: All SQL operations use parameter binding to prevent injection attacks
2. **Identifier Validation**: Table and column names are validated against PostgreSQL naming rules
3. **Required WHERE Clauses**: UPDATE and DELETE operations require WHERE conditions for safety
4. **Large Operation Warnings**: Confirmation required for operations affecting >100 rows
5. **Connection Security**: Use SSL connections in production environments
6. **Access Control**: Configure database-level permissions appropriately

## Database Permissions

The database user should have appropriate permissions for the operations you want to allow:

```sql
-- For read-only access
GRANT SELECT ON ALL TABLES IN SCHEMA public TO your_user;

-- For full access
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_user;

-- For schema introspection
GRANT USAGE ON SCHEMA information_schema TO your_user;
GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO your_user;
```

## Example Usage

Once connected through an MCP client:

```
AI: Can you show me the structure of the users table?
Assistant: I'll get the table information for you.

[Uses get-table-info tool]

The users table has the following structure:
- id (integer, primary key)
- email (varchar, unique, not null)
- name (varchar)
- created_at (timestamp with time zone)
...
```

```
AI: Find all users created in the last 7 days
Assistant: I'll query the users table for recent records.

[Uses query-table tool with WHERE condition]

Found 15 users created in the last 7 days:
...
```

## Development

### Testing

This project includes comprehensive tests using Vitest and Testcontainers for real PostgreSQL database testing.

**Prerequisites:**
- Docker must be installed and running (for testcontainers)

**Run all tests:**
```bash
npm test
```

**Run tests in watch mode:**
```bash
# Watch mode for development
npm run test:watch
```

### Type Checking

```bash
npm run typecheck
```

### Building

```bash
npm run build
```

## Architecture

- **index.ts**: Main server entry point and tool registration
- **tools/utils.ts**: Shared utilities, database connection, and helper functions
- **tools/*.ts**: Individual tool implementations
- **tests/**: Comprehensive test suite
- **tsup.config.ts**: Build configuration
- **tsconfig.json**: TypeScript configuration
- **vitest.config.ts**: Test configuration

## Error Handling

All tools include comprehensive error handling:
- Input validation with Zod schemas
- Database connection error handling
- SQL execution error handling
- Graceful error responses to MCP clients
- **Graceful startup**: Server starts even if database is unavailable
- **Connection recovery**: Ability to retry connections without restarting

### Connection Troubleshooting

If the database connection fails at startup or during operation, the server will continue running and provide helpful error information through the `connection-status` tool.

**Common connection issues:**
1. **Database server not running**: Ensure PostgreSQL is running and accessible
2. **Invalid credentials**: Check username, password, and database name in your configuration  
3. **Network connectivity**: Verify host, port, and firewall settings
4. **SSL/TLS issues**: Check SSL configuration for production environments
5. **Connection string format**: Ensure DATABASE_URL follows the correct format

**To diagnose and fix connection issues:**

1. **Check connection status:**
   ```
   Use the connection-status tool to see current status and error details
   ```

2. **Verify configuration:**
   ```bash
   # Check your .env file or environment variables
   echo $DATABASE_URL
   # Should look like: postgresql://username:password@host:port/database
   ```

3. **Test manually:**
   ```bash
   # Test connection with psql
   psql $DATABASE_URL -c "SELECT 1;"
   ```

4. **Retry connection:**
   ```
   Use the connection-status tool with retry: true to attempt reconnection
   ```

**Graceful degradation:**
- If database connection fails, all database tools will return helpful error messages
- Error messages include specific troubleshooting steps
- Tools automatically guide users to use `connection-status` for diagnosis and retry
- Once connection is restored (via retry), all tools resume normal operation

## Contributing

1. Follow the existing code patterns
2. Add proper TypeScript types
3. Include error handling
4. Test with a real PostgreSQL database
5. Update documentation as needed

## License

MIT License