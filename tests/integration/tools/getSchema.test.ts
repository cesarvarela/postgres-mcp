import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSchema, getSchemaSchema } from '../../../tools/getSchema';
import { cleanTestData, getTestPool, insertTestData } from '../../setup/test-setup';
import { executeTestQuery, expectMcpError, expectValidMcpResponse, extractJsonFromMcpResponse, createTestTable, dropTestTable } from '../../setup/test-helpers';

describe('getSchema Tool', () => {
  beforeEach(async () => {
    await cleanTestData();
    await insertTestData(); // Ensure we have data and table structure
  });

  describe('Schema Validation', () => {
    it('should validate minimal valid parameters', () => {
      const params = {};
      const result = getSchemaSchema.parse(params);
      
      expect(result.schema_name).toBe('public'); // default
      expect(result.include_columns).toBe(true); // default
      expect(result.include_constraints).toBe(false); // default
      expect(result.table_pattern).toBeUndefined(); // optional
    });

    it('should validate complete parameters', () => {
      const params = {
        schema_name: 'public',
        table_pattern: 'user%',
        include_columns: true,
        include_constraints: true
      };
      
      const result = getSchemaSchema.parse(params);
      expect(result).toEqual(params);
    });

    it('should apply default values correctly', () => {
      const params = { schema_name: 'test' };
      const result = getSchemaSchema.parse(params);
      
      expect(result.schema_name).toBe('test');
      expect(result.include_columns).toBe(true);
      expect(result.include_constraints).toBe(false);
    });
  });

  describe('Basic Schema Discovery', () => {
    it('should get schema information successfully', async () => {
      const response = await getSchema({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.schema).toBe('public');
      expect(typeof data.table_count).toBe('number');
      expect(data.table_count).toBeGreaterThan(0);
      expect(Array.isArray(data.tables)).toBe(true);
      expect(data.tables.length).toBe(data.table_count);
      expect(data.generated_at).toBeDefined();
    });

    it('should list available tables', async () => {
      const response = await getSchema({
        schema_name: 'public'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.tables.length).toBeGreaterThan(0);
      
      // Should include the users table
      const usersTable = data.tables.find((table: any) => table.table_name === 'users');
      expect(usersTable).toBeDefined();
      expect(usersTable.table_schema).toBe('public');
      expect(usersTable.table_type).toBe('BASE TABLE');
    });

    it('should include table types', async () => {
      const response = await getSchema({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.tables.forEach((table: any) => {
        expect(table.table_name).toBeDefined();
        expect(table.table_schema).toBe('public');
        expect(table.table_type).toMatch(/^(BASE TABLE|VIEW|MATERIALIZED VIEW)$/);
      });
    });
  });

  describe('Table Pattern Filtering', () => {
    it('should filter tables by pattern', async () => {
      const response = await getSchema({
        table_pattern: 'user%'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // All returned tables should match the pattern
      data.tables.forEach((table: any) => {
        expect(table.table_name).toMatch(/^user/);
      });
      
      // Should include users table
      const usersTable = data.tables.find((table: any) => table.table_name === 'users');
      expect(usersTable).toBeDefined();
    });

    it('should handle exact table name pattern', async () => {
      const response = await getSchema({
        table_pattern: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table_count).toBe(1);
      expect(data.tables[0].table_name).toBe('users');
    });

    it('should return empty result for non-matching pattern', async () => {
      const response = await getSchema({
        table_pattern: 'nonexistent_%'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table_count).toBe(0);
      expect(data.tables).toEqual([]);
    });

    it('should handle wildcard patterns', async () => {
      const response = await getSchema({
        table_pattern: '%'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Should return all tables (same as no pattern)
      expect(data.table_count).toBeGreaterThan(0);
    });
  });

  describe('Column Information', () => {
    it('should include column information by default', async () => {
      const response = await getSchema({
        table_pattern: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const usersTable = data.tables[0];
      expect(usersTable.columns).toBeDefined();
      expect(Array.isArray(usersTable.columns)).toBe(true);
      expect(usersTable.columns.length).toBeGreaterThan(0);
      
      // Check for expected columns
      const columnNames = usersTable.columns.map((col: any) => col.column_name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('email');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('age');
      expect(columnNames).toContain('is_active');
    });

    it('should exclude column information when requested', async () => {
      const response = await getSchema({
        table_pattern: 'users',
        include_columns: false
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const usersTable = data.tables[0];
      expect(usersTable.columns).toEqual([]);
    });

    it('should provide detailed column information', async () => {
      const response = await getSchema({
        table_pattern: 'users',
        include_columns: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const usersTable = data.tables[0];
      usersTable.columns.forEach((column: any) => {
        expect(column.column_name).toBeDefined();
        expect(column.data_type).toBeDefined();
        expect(column.is_nullable).toMatch(/^(YES|NO)$/);
        
        // Optional fields
        if (column.character_maximum_length !== null) {
          expect(typeof column.character_maximum_length).toBe('number');
        }
        if (column.numeric_precision !== null) {
          expect(typeof column.numeric_precision).toBe('number');
        }
        if (column.numeric_scale !== null) {
          expect(typeof column.numeric_scale).toBe('number');
        }
      });
      
      // Verify specific column details
      const idColumn = usersTable.columns.find((col: any) => col.column_name === 'id');
      expect(idColumn).toBeDefined();
      expect(idColumn.data_type).toBe('integer');
      expect(idColumn.is_nullable).toBe('NO');
      
      const emailColumn = usersTable.columns.find((col: any) => col.column_name === 'email');
      expect(emailColumn).toBeDefined();
      expect(emailColumn.data_type).toBe('character varying');
      expect(emailColumn.is_nullable).toBe('NO');
    });
  });

  describe('Constraint Information', () => {
    it('should exclude constraint information by default', async () => {
      const response = await getSchema({
        table_pattern: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const usersTable = data.tables[0];
      expect(usersTable.constraints).toEqual([]);
    });

    it('should include constraint information when requested', async () => {
      const response = await getSchema({
        table_pattern: 'users',
        include_constraints: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const usersTable = data.tables[0];
      expect(usersTable.constraints).toBeDefined();
      expect(Array.isArray(usersTable.constraints)).toBe(true);
      expect(usersTable.constraints.length).toBeGreaterThan(0);
      
      // Should have at least primary key constraint
      const constraintTypes = usersTable.constraints.map((c: any) => c.constraint_type);
      expect(constraintTypes).toContain('PRIMARY KEY');
    });

    it('should provide detailed constraint information', async () => {
      const response = await getSchema({
        table_pattern: 'users',
        include_constraints: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const usersTable = data.tables[0];
      usersTable.constraints.forEach((constraint: any) => {
        expect(constraint.constraint_name).toBeDefined();
        expect(constraint.constraint_type).toBeDefined();
        expect(constraint.column_name).toBeDefined();
        
        // Foreign key constraints have additional fields
        if (constraint.constraint_type === 'FOREIGN KEY') {
          expect(constraint.foreign_table_name).toBeDefined();
          expect(constraint.foreign_column_name).toBeDefined();
        }
      });
    });
  });

  describe('Multiple Tables', () => {
    beforeEach(async () => {
      // Create additional test tables
      await createTestTable('multi_products', `
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2),
        category_id INTEGER
      `);
      
      await createTestTable('multi_categories', `
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT
      `);
    });

    afterEach(async () => {
      await dropTestTable('multi_products');
      await dropTestTable('multi_categories');
    });

    it('should return multiple tables', async () => {
      const response = await getSchema({
        table_pattern: 'multi_%'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table_count).toBe(2);
      expect(data.tables.length).toBe(2);
      
      const tableNames = data.tables.map((table: any) => table.table_name);
      expect(tableNames).toContain('multi_products');
      expect(tableNames).toContain('multi_categories');
    });

    it('should include columns for all tables', async () => {
      const response = await getSchema({
        table_pattern: 'multi_%',
        include_columns: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.tables.forEach((table: any) => {
        expect(table.columns).toBeDefined();
        expect(Array.isArray(table.columns)).toBe(true);
        expect(table.columns.length).toBeGreaterThan(0);
      });
      
      const productsTable = data.tables.find((table: any) => table.table_name === 'multi_products');
      const categoriesTable = data.tables.find((table: any) => table.table_name === 'multi_categories');
      
      expect(productsTable.columns.length).toBe(4); // id, name, price, category_id
      expect(categoriesTable.columns.length).toBe(3); // id, name, description
    });

    it('should include constraints for all tables', async () => {
      const response = await getSchema({
        table_pattern: 'multi_%',
        include_constraints: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.tables.forEach((table: any) => {
        expect(table.constraints).toBeDefined();
        expect(Array.isArray(table.constraints)).toBe(true);
      });
      
      const categoriesTable = data.tables.find((table: any) => table.table_name === 'multi_categories');
      const constraintTypes = categoriesTable.constraints.map((c: any) => c.constraint_type);
      expect(constraintTypes).toContain('PRIMARY KEY');
      expect(constraintTypes).toContain('UNIQUE');
    });
  });

  describe('Different Schema Names', () => {
    it('should handle explicit public schema', async () => {
      const response = await getSchema({
        schema_name: 'public'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.schema).toBe('public');
      expect(data.table_count).toBeGreaterThan(0);
      
      data.tables.forEach((table: any) => {
        expect(table.table_schema).toBe('public');
      });
    });

    it('should handle non-existent schema', async () => {
      const response = await getSchema({
        schema_name: 'nonexistent_schema'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.schema).toBe('nonexistent_schema');
      expect(data.table_count).toBe(0);
      expect(data.tables).toEqual([]);
    });

    it('should handle information_schema', async () => {
      const response = await getSchema({
        schema_name: 'information_schema',
        table_pattern: 'tables'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.schema).toBe('information_schema');
      expect(data.table_count).toBe(1);
      expect(data.tables[0].table_name).toBe('tables');
      expect(data.tables[0].table_type).toBe('VIEW');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid schema names gracefully', async () => {
      // This should not error, just return empty results
      const response = await getSchema({
        schema_name: '123invalid'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table_count).toBe(0);
      expect(data.tables).toEqual([]);
    });

    it('should handle special characters in patterns', async () => {
      const response = await getSchema({
        table_pattern: '%_test_%'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Should handle the pattern without errors
      expect(typeof data.table_count).toBe('number');
      expect(Array.isArray(data.tables)).toBe(true);
    });
  });

  describe('Views and Materialized Views', () => {
    beforeEach(async () => {
      // Create a test view
      await executeTestQuery(`
        CREATE VIEW users_summary AS 
        SELECT id, email, name, is_active 
        FROM users 
        WHERE is_active = true
      `);
    });

    afterEach(async () => {
      await executeTestQuery('DROP VIEW IF EXISTS users_summary');
    });

    it('should include views in schema discovery', async () => {
      const response = await getSchema({
        table_pattern: 'users_%'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const usersView = data.tables.find((table: any) => table.table_name === 'users_summary');
      expect(usersView).toBeDefined();
      expect(usersView.table_type).toBe('VIEW');
    });

    it('should include view columns', async () => {
      const response = await getSchema({
        table_pattern: 'users_summary',
        include_columns: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table_count).toBe(1);
      const viewTable = data.tables[0];
      expect(viewTable.columns.length).toBe(4); // id, email, name, is_active
      
      const columnNames = viewTable.columns.map((col: any) => col.column_name);
      expect(columnNames).toEqual(['id', 'email', 'name', 'is_active']);
    });
  });

  describe('Performance', () => {
    it('should perform efficiently with columns', async () => {
      const startTime = Date.now();
      
      const response = await getSchema({
        include_columns: true
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table_count).toBeGreaterThan(0);
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
    });

    it('should be faster without columns and constraints', async () => {
      const startTime = Date.now();
      
      const response = await getSchema({
        include_columns: false,
        include_constraints: false
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      expect(duration).toBeLessThan(1000); // Should be faster
    });

    it('should handle large schemas efficiently', async () => {
      const response = await getSchema({
        schema_name: 'information_schema',
        include_columns: false
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // information_schema has many tables/views
      expect(data.table_count).toBeGreaterThan(20);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty schema', async () => {
      const response = await getSchema({
        schema_name: 'nonexistent'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.schema).toBe('nonexistent');
      expect(data.table_count).toBe(0);
      expect(data.tables).toEqual([]);
      expect(data.generated_at).toBeDefined();
    });

    it('should handle patterns with no matches', async () => {
      const response = await getSchema({
        table_pattern: 'xyz_nonexistent_%'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table_count).toBe(0);
      expect(data.tables).toEqual([]);
    });

    it('should maintain consistent response structure', async () => {
      const response = await getSchema({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Verify required fields
      expect(data).toHaveProperty('schema');
      expect(data).toHaveProperty('table_count');
      expect(data).toHaveProperty('tables');
      expect(data).toHaveProperty('generated_at');
      
      // Verify data types
      expect(typeof data.schema).toBe('string');
      expect(typeof data.table_count).toBe('number');
      expect(Array.isArray(data.tables)).toBe(true);
      expect(typeof data.generated_at).toBe('string');
      
      // Verify timestamp format
      expect(new Date(data.generated_at).toISOString()).toBe(data.generated_at);
    });
  });

  describe('Combined Options', () => {
    it('should handle all options together', async () => {
      const response = await getSchema({
        schema_name: 'public',
        table_pattern: 'users',
        include_columns: true,
        include_constraints: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.schema).toBe('public');
      expect(data.table_count).toBe(1);
      expect(data.tables[0].table_name).toBe('users');
      expect(data.tables[0].columns.length).toBeGreaterThan(0);
      expect(data.tables[0].constraints.length).toBeGreaterThan(0);
    });

    it('should maintain data consistency across options', async () => {
      // Get basic info
      const basicResponse = await getSchema({
        table_pattern: 'users',
        include_columns: false,
        include_constraints: false
      });
      
      // Get detailed info
      const detailedResponse = await getSchema({
        table_pattern: 'users',
        include_columns: true,
        include_constraints: true
      });
      
      expectValidMcpResponse(basicResponse);
      expectValidMcpResponse(detailedResponse);
      
      const basicData = extractJsonFromMcpResponse(basicResponse);
      const detailedData = extractJsonFromMcpResponse(detailedResponse);
      
      // Basic table info should be the same
      expect(basicData.table_count).toBe(detailedData.table_count);
      expect(basicData.tables[0].table_name).toBe(detailedData.tables[0].table_name);
      expect(basicData.tables[0].table_schema).toBe(detailedData.tables[0].table_schema);
      expect(basicData.tables[0].table_type).toBe(detailedData.tables[0].table_type);
      
      // Extended info should be present in detailed response
      expect(basicData.tables[0].columns).toEqual([]);
      expect(basicData.tables[0].constraints).toEqual([]);
      expect(detailedData.tables[0].columns.length).toBeGreaterThan(0);
      expect(detailedData.tables[0].constraints.length).toBeGreaterThan(0);
    });
  });
});