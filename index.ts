#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { debug, testConnection, closePool } from "./tools/utils.js";

// Import all tools
import { queryTable, queryTableShape } from "./tools/queryTable.js";
import { getSchema, getSchemaShape } from "./tools/getSchema.js";
import { executeQuery, executeQueryShape } from "./tools/executeQuery.js";
import { insertData, insertDataShape } from "./tools/insertData.js";
import { updateData, updateDataShape } from "./tools/updateData.js";
import { deleteData, deleteDataShape } from "./tools/deleteData.js";
import { getTableInfo, getTableInfoShape } from "./tools/getTableInfo.js";

// Load environment variables
dotenv.config();

const server = new McpServer({
  name: "postgres-mcp",
  version: "1.0.0",
  description: "PostgreSQL Model Context Protocol Server - Expose PostgreSQL database operations via MCP",
  debug: process.env.NODE_ENV === 'development',
});

// Register all tools
server.tool(
  "query-table",
  "Query data from a specific table with filtering, pagination, and sorting. Supports WHERE conditions with exact matches, arrays (IN), and LIKE patterns.",
  queryTableShape,
  queryTable
);

server.tool(
  "get-schema",
  "Get database schema information including tables, columns, data types, and optionally constraints. Useful for understanding database structure.",
  getSchemaShape,
  getSchema
);

server.tool(
  "execute-query",
  "Execute a parameterized SQL query with safety checks. Supports SELECT, INSERT, UPDATE, DELETE operations with parameter binding to prevent SQL injection.",
  executeQueryShape,
  executeQuery
);

server.tool(
  "insert-data",
  "Insert new records into a table. Supports single or multiple records, conflict resolution (ignore/update), and returning inserted data.",
  insertDataShape,
  insertData
);

server.tool(
  "update-data",
  "Update existing records in a table. Requires WHERE conditions for safety. Supports complex WHERE clauses and returns updated records.",
  updateDataShape,
  updateData
);

server.tool(
  "delete-data",
  "Delete records from a table. Requires WHERE conditions for safety. Includes confirmation prompt for large deletions.",
  deleteDataShape,
  deleteData
);

server.tool(
  "get-table-info",
  "Get detailed information about a specific table including columns, constraints, indexes, and optionally statistics like row count and size.",
  getTableInfoShape,
  getTableInfo
);

async function main() {
  // Test database connection on startup
  debug("Testing database connection...");
  const connectionOk = await testConnection();
  
  if (!connectionOk) {
    debug("Failed to connect to database. Please check your connection settings.");
    process.exit(1);
  }
  
  debug("Database connection successful");

  // Set up transport and start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  debug("PostgreSQL MCP Server running on stdio");
  debug("Available tools: query-table, get-schema, execute-query, insert-data, update-data, delete-data, get-table-info");
}

// Graceful shutdown handling
async function shutdown(signal: string) {
  debug(`Received ${signal}, shutting down gracefully...`);
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Error handling
process.on("unhandledRejection", (reason, promise) => {
  debug("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  debug("Uncaught Exception:", error);
  process.exit(1);
});

// Start the server
main().catch((error) => {
  debug("Server failed to start:", error);
  process.exit(1);
});