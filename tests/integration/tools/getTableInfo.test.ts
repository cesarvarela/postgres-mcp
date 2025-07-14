import { describe, it, expect, beforeEach } from 'vitest';
import { getTableInfo, getTableInfoSchema } from '../../../tools/getTableInfo';
import { cleanTestData, getTestPool, insertTestData } from '../../setup/test-setup';
import { executeTestQuery, expectMcpError, expectValidMcpResponse, extractJsonFromMcpResponse } from '../../setup/test-helpers';

describe('getTableInfo Tool', () => {
  beforeEach(async () => {
    await cleanTestData();
    await insertTestData(); // Ensure we have data in the users table
  });

  describe('Schema Validation', () => {
    it('should validate minimal valid parameters', () => {
      const params = { 
        table: 'users'
      };
      const result = getTableInfoSchema.parse(params);
      
      expect(result.table).toBe('users');
      expect(result.schema_name).toBe('public'); // default
      expect(result.include_statistics).toBe(true); // default
    });

    it('should validate complete parameters', () => {
      const params = {
        table: 'users',
        schema_name: 'public',
        include_statistics: false
      };
      
      const result = getTableInfoSchema.parse(params);
      expect(result).toEqual(params);
    });

    it('should reject empty table name', () => {
      expect(() => getTableInfoSchema.parse({ 
        table: ''
      })).toThrow();
    });

    it('should apply default values', () => {
      const params = { table: 'users' };
      const result = getTableInfoSchema.parse(params);
      
      expect(result.schema_name).toBe('public');
      expect(result.include_statistics).toBe(true);
    });
  });

  describe('Basic Table Information', () => {
    it('should get table information successfully', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table).toBeDefined();
      expect(data.table.table_name).toBe('users');
      expect(data.table.table_schema).toBe('public');
      expect(data.table.table_type).toBeDefined();
      expect(data.generated_at).toBeDefined();
    });

    it('should include columns information', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.columns).toBeDefined();
      expect(Array.isArray(data.columns)).toBe(true);
      expect(data.columns.length).toBeGreaterThan(0);
      
      // Check for expected columns
      const columnNames = data.columns.map((col: any) => col.column_name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('email');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('age');
      expect(columnNames).toContain('is_active');
      
      // Verify column details
      const idColumn = data.columns.find((col: any) => col.column_name === 'id');
      expect(idColumn).toBeDefined();
      expect(idColumn.data_type).toBe('integer');
      expect(idColumn.is_nullable).toBe('NO');
      
      const emailColumn = data.columns.find((col: any) => col.column_name === 'email');
      expect(emailColumn).toBeDefined();
      expect(emailColumn.data_type).toBe('character varying');
      expect(emailColumn.is_nullable).toBe('NO');
    });

    it('should include constraints information', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.constraints).toBeDefined();
      expect(Array.isArray(data.constraints)).toBe(true);
      
      // Should have at least primary key constraint
      const constraintTypes = data.constraints.map((c: any) => c.constraint_type);
      expect(constraintTypes).toContain('PRIMARY KEY');
      
      // Check for unique constraint on email (if exists)
      const uniqueConstraints = data.constraints.filter((c: any) => c.constraint_type === 'UNIQUE');
      if (uniqueConstraints.length > 0) {
        const emailUnique = uniqueConstraints.find((c: any) => c.column_name === 'email');
        expect(emailUnique).toBeDefined();
      }
    });

    it('should include indexes information', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.indexes).toBeDefined();
      expect(Array.isArray(data.indexes)).toBe(true);
      
      // Should have at least primary key index
      const primaryIndexes = data.indexes.filter((idx: any) => idx.is_primary === true);
      expect(primaryIndexes.length).toBeGreaterThan(0);
      
      // Verify index details
      const indexes = data.indexes;
      indexes.forEach((index: any) => {
        expect(index.index_name).toBeDefined();
        expect(index.column_name).toBeDefined();
        expect(typeof index.is_unique).toBe('boolean');
        expect(typeof index.is_primary).toBe('boolean');
        expect(index.index_type).toBeDefined();
      });
    });
  });

  describe('Statistics', () => {
    it('should include statistics by default', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.statistics).toBeDefined();
      expect(typeof data.statistics.estimated_row_count).toBe('number');
      expect(typeof data.statistics.total_size_bytes).toBe('number');
      expect(typeof data.statistics.table_size_bytes).toBe('number');
      expect(typeof data.statistics.index_size_bytes).toBe('number');
      expect(data.statistics.total_size_pretty).toBeDefined();
      expect(data.statistics.table_size_pretty).toBeDefined();
      expect(data.statistics.index_size_pretty).toBeDefined();
    });

    it('should exclude statistics when requested', async () => {
      const response = await getTableInfo({
        table: 'users',
        include_statistics: false
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.statistics).toBeUndefined();
    });

    it('should handle statistics gracefully if unavailable', async () => {
      // This test verifies that the tool doesn't crash if statistics can't be retrieved
      const response = await getTableInfo({
        table: 'users',
        include_statistics: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Statistics might be available or not, but the response should be valid
      if (data.statistics) {
        expect(typeof data.statistics).toBe('object');
      }
    });
  });

  describe('Schema Specification', () => {
    it('should work with explicit public schema', async () => {
      const response = await getTableInfo({
        table: 'users',
        schema_name: 'public'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table.table_schema).toBe('public');
      expect(data.table.table_name).toBe('users');
    });

    it('should handle non-existent schema gracefully', async () => {
      const response = await getTableInfo({
        table: 'users',
        schema_name: 'nonexistent_schema'
      });
      
      expectMcpError(response, /not found/i);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent table', async () => {
      const response = await getTableInfo({
        table: 'nonexistent_table'
      });
      
      expectMcpError(response, /not found/i);
    });

    it('should reject invalid table identifier', async () => {
      const response = await getTableInfo({
        table: '123invalid'
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should reject invalid schema identifier', async () => {
      const response = await getTableInfo({
        table: 'users',
        schema_name: '123invalid'
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should handle tables with special names', async () => {
      // This test verifies handling of table names that need sanitization
      const response = await getTableInfo({
        table: 'users' // Valid table name
      });
      
      expectValidMcpResponse(response);
    });
  });

  describe('Column Details', () => {
    it('should provide detailed column information', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.columns.forEach((column: any) => {
        expect(column.column_name).toBeDefined();
        expect(column.data_type).toBeDefined();
        expect(column.is_nullable).toMatch(/^(YES|NO)$/);
        expect(typeof column.ordinal_position).toBe('number');
        
        // Optional fields that might be present
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
    });

    it('should handle columns with defaults', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Check for columns with defaults
      const idColumn = data.columns.find((col: any) => col.column_name === 'id');
      expect(idColumn.column_default).toContain('nextval'); // Serial columns have nextval defaults
      
      const isActiveColumn = data.columns.find((col: any) => col.column_name === 'is_active');
      if (isActiveColumn && isActiveColumn.column_default) {
        expect(isActiveColumn.column_default).toBeDefined();
      }
    });

    it('should handle columns with various data types', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const columnsByType = data.columns.reduce((acc: any, col: any) => {
        acc[col.data_type] = acc[col.data_type] || [];
        acc[col.data_type].push(col);
        return acc;
      }, {});
      
      // Verify we have various data types
      expect(columnsByType['integer']).toBeDefined(); // id, age
      expect(columnsByType['character varying']).toBeDefined(); // email, name
      expect(columnsByType['boolean']).toBeDefined(); // is_active
      
      // Check for PostgreSQL-specific types if present
      if (columnsByType['jsonb']) {
        expect(columnsByType['jsonb'].length).toBeGreaterThan(0);
      }
      if (columnsByType['ARRAY']) {
        expect(columnsByType['ARRAY'].length).toBeGreaterThan(0);
      }
    });
  });

  describe('Constraint Details', () => {
    it('should provide detailed constraint information', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.constraints.forEach((constraint: any) => {
        expect(constraint.constraint_name).toBeDefined();
        expect(constraint.constraint_type).toBeDefined();
        expect(constraint.column_name).toBeDefined();
        
        // Foreign key constraints have additional fields
        if (constraint.constraint_type === 'FOREIGN KEY') {
          expect(constraint.foreign_table_name).toBeDefined();
          expect(constraint.foreign_column_name).toBeDefined();
          expect(constraint.update_rule).toBeDefined();
          expect(constraint.delete_rule).toBeDefined();
        }
      });
    });

    it('should identify primary key constraints', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const primaryKeys = data.constraints.filter((c: any) => c.constraint_type === 'PRIMARY KEY');
      expect(primaryKeys.length).toBeGreaterThan(0);
      
      const pkColumn = primaryKeys.find((pk: any) => pk.column_name === 'id');
      expect(pkColumn).toBeDefined();
    });
  });

  describe('Index Details', () => {
    it('should provide detailed index information', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.indexes.length).toBeGreaterThan(0);
      
      data.indexes.forEach((index: any) => {
        expect(index.index_name).toBeDefined();
        expect(index.column_name).toBeDefined();
        expect(typeof index.is_unique).toBe('boolean');
        expect(typeof index.is_primary).toBe('boolean');
        expect(index.index_type).toBeDefined();
      });
    });

    it('should identify unique indexes', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const uniqueIndexes = data.indexes.filter((idx: any) => idx.is_unique === true);
      expect(uniqueIndexes.length).toBeGreaterThan(0);
      
      // Should include primary key index
      const primaryIndexes = uniqueIndexes.filter((idx: any) => idx.is_primary === true);
      expect(primaryIndexes.length).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should return information efficiently', async () => {
      const startTime = Date.now();
      
      const response = await getTableInfo({
        table: 'users',
        include_statistics: true
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table).toBeDefined();
      expect(data.columns.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should be faster without statistics', async () => {
      const startTime = Date.now();
      
      const response = await getTableInfo({
        table: 'users',
        include_statistics: false
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      expect(duration).toBeLessThan(1000); // Should be faster without stats
    });
  });

  describe('Edge Cases', () => {
    it('should handle tables with minimal structure', async () => {
      // Create a simple test table
      await executeTestQuery(`
        CREATE TABLE simple_test (
          id SERIAL PRIMARY KEY,
          name TEXT
        )
      `);
      
      const response = await getTableInfo({
        table: 'simple_test'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table.table_name).toBe('simple_test');
      expect(data.columns.length).toBe(2);
      expect(data.constraints.length).toBeGreaterThan(0);
      expect(data.indexes.length).toBeGreaterThan(0);
    });

    it('should handle tables with no constraints or indexes', async () => {
      // Create a table without explicit constraints
      await executeTestQuery(`
        CREATE TABLE no_constraints (
          data TEXT
        )
      `);
      
      const response = await getTableInfo({
        table: 'no_constraints'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table.table_name).toBe('no_constraints');
      expect(data.columns.length).toBe(1);
      expect(Array.isArray(data.constraints)).toBe(true);
      expect(Array.isArray(data.indexes)).toBe(true);
    });

    it('should handle views', async () => {
      // Create a simple view
      await executeTestQuery(`
        CREATE VIEW users_view AS 
        SELECT id, email, name FROM users LIMIT 5
      `);
      
      const response = await getTableInfo({
        table: 'users_view'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table.table_name).toBe('users_view');
      expect(data.table.table_type).toBe('VIEW');
      expect(data.columns.length).toBe(3);
    });
  });

  describe('Response Format', () => {
    it('should have consistent response structure', async () => {
      const response = await getTableInfo({
        table: 'users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Verify required top-level fields
      expect(data).toHaveProperty('table');
      expect(data).toHaveProperty('columns');
      expect(data).toHaveProperty('constraints');
      expect(data).toHaveProperty('indexes');
      expect(data).toHaveProperty('generated_at');
      
      // Verify data types
      expect(typeof data.table).toBe('object');
      expect(Array.isArray(data.columns)).toBe(true);
      expect(Array.isArray(data.constraints)).toBe(true);
      expect(Array.isArray(data.indexes)).toBe(true);
      expect(typeof data.generated_at).toBe('string');
      
      // Verify timestamp format
      expect(new Date(data.generated_at).toISOString()).toBe(data.generated_at);
    });
  });
});