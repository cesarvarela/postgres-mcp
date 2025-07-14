import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executePostgresQuery,
  createMcpSuccessResponse,
  createMcpErrorResponse,
  paginationSchema,
  sortSchema,
  validateIdentifier,
  sanitizeIdentifier,
  testConnection,
} from '../../tools/utils';
import { 
  getTestPool, 
  insertTestData, 
  cleanTestData,
  expectValidMcpResponse,
  expectMcpError,
  executeTestQuery
} from '../setup/test-helpers';
import '../setup/test-setup'; // Import for side effects (beforeEach setup)

describe('Database Utils', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  describe('executePostgresQuery', () => {
    it('should execute simple SELECT query successfully', async () => {
      const result = await executePostgresQuery('SELECT 1 as test_value');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ test_value: 1 });
    });

    it('should execute parameterized query successfully', async () => {
      await insertTestData();
      
      const result = await executePostgresQuery(
        'SELECT * FROM users WHERE email = $1',
        ['john@example.com']
      );
      
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('john@example.com');
      expect(result[0].name).toBe('John Doe');
    });

    it('should handle multiple parameters correctly', async () => {
      await insertTestData();
      
      const result = await executePostgresQuery(
        'SELECT * FROM users WHERE age > $1 AND is_active = $2',
        [25, true]
      );
      
      expect(result.length).toBeGreaterThan(0);
      result.forEach(user => {
        expect(user.age).toBeGreaterThan(25);
        expect(user.is_active).toBe(true);
      });
    });

    it('should return empty array for no results', async () => {
      const result = await executePostgresQuery(
        'SELECT * FROM users WHERE email = $1',
        ['nonexistent@example.com']
      );
      
      expect(result).toHaveLength(0);
    });

    it('should handle INSERT operations and return inserted data', async () => {
      const result = await executePostgresQuery(
        `INSERT INTO users (email, name, age, is_active) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`,
        ['newuser@example.com', 'New User', 30, true]
      );
      
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('newuser@example.com');
      expect(result[0].name).toBe('New User');
      expect(result[0].id).toBeDefined();
    });

    it('should handle UPDATE operations', async () => {
      const testData = await insertTestData();
      const userId = testData.users[0].id;
      
      const result = await executePostgresQuery(
        'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
        ['Updated Name', userId]
      );
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Updated Name');
    });

    it('should handle DELETE operations', async () => {
      const testData = await insertTestData();
      const userId = testData.users[0].id;
      
      const result = await executePostgresQuery(
        'DELETE FROM users WHERE id = $1 RETURNING id',
        [userId]
      );
      
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(userId);
      
      // Verify deletion
      const checkResult = await executePostgresQuery(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      expect(checkResult).toHaveLength(0);
    });

    it('should throw error for invalid SQL syntax', async () => {
      await expect(
        executePostgresQuery('INVALID SQL SYNTAX')
      ).rejects.toThrow(/Database query failed/);
    });

    it('should throw error for SQL constraint violations', async () => {
      await insertTestData();
      
      // Try to insert duplicate email (unique constraint violation)
      await expect(
        executePostgresQuery(
          'INSERT INTO users (email, name) VALUES ($1, $2)',
          ['john@example.com', 'Duplicate User']
        )
      ).rejects.toThrow(/Database query failed/);
    });

    it('should handle complex queries with JOINs', async () => {
      await insertTestData();
      
      const result = await executePostgresQuery(`
        SELECT u.name, p.name as product_name, o.quantity, o.total
        FROM users u
        JOIN orders o ON u.id = o.user_id
        JOIN products p ON o.product_id = p.id
        WHERE u.email = $1
      `, ['john@example.com']);
      
      expect(result.length).toBeGreaterThan(0);
      result.forEach(row => {
        expect(row.name).toBeDefined();
        expect(row.product_name).toBeDefined();
        expect(row.quantity).toBeDefined();
        expect(row.total).toBeDefined();
      });
    });

    it('should handle queries with different data types', async () => {
      // test_types table is now created in standard test schema
      
      const testData = {
        text_col: 'Test string',
        int_col: 42,
        bool_col: true,
        json_col: { key: 'value', nested: { data: 123 } },
        array_col: ['item1', 'item2', 'item3'],
        timestamp_col: new Date().toISOString()
      };
      
      const result = await executePostgresQuery(`
        INSERT INTO test_types (text_col, int_col, bool_col, json_col, array_col, timestamp_col)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        testData.text_col,
        testData.int_col,
        testData.bool_col,
        JSON.stringify(testData.json_col),
        testData.array_col,
        testData.timestamp_col
      ]);
      
      expect(result).toHaveLength(1);
      expect(result[0].text_col).toBe(testData.text_col);
      expect(result[0].int_col).toBe(testData.int_col);
      expect(result[0].bool_col).toBe(testData.bool_col);
      expect(result[0].json_col).toEqual(testData.json_col);
      expect(result[0].array_col).toEqual(testData.array_col);
    });
  });

  describe('MCP Response Functions', () => {
    describe('createMcpSuccessResponse', () => {
      it('should create valid MCP success response with simple data', async () => {
        const data = { message: 'success', count: 5 };
        const response = await createMcpSuccessResponse(data);
        
        expectValidMcpResponse(response);
        
        const parsedData = JSON.parse(response.content[0].text);
        expect(parsedData).toEqual(data);
      });

      it('should create valid MCP success response with complex data', async () => {
        const data = {
          users: [
            { id: 1, name: 'John', metadata: { role: 'admin' } },
            { id: 2, name: 'Jane', metadata: { role: 'user' } }
          ],
          pagination: { total: 2, page: 1 },
          timestamp: new Date().toISOString()
        };
        
        const response = await createMcpSuccessResponse(data);
        
        expectValidMcpResponse(response);
        
        const parsedData = JSON.parse(response.content[0].text);
        expect(parsedData).toEqual(data);
        expect(parsedData.users).toHaveLength(2);
      });

      it('should handle null and undefined values', async () => {
        const data = { value: null, missing: undefined };
        const response = await createMcpSuccessResponse(data);
        
        expectValidMcpResponse(response);
        
        const parsedData = JSON.parse(response.content[0].text);
        expect(parsedData.value).toBeNull();
        expect(parsedData).not.toHaveProperty('missing'); // undefined removed by JSON.stringify
      });

      it('should format JSON with proper indentation', async () => {
        const data = { nested: { deep: { value: 'test' } } };
        const response = await createMcpSuccessResponse(data);
        
        const text = response.content[0].text;
        expect(text).toContain('  '); // Should have indentation
        expect(text.split('\n').length).toBeGreaterThan(1); // Should be multi-line
      });
    });

    describe('createMcpErrorResponse', () => {
      it('should create valid MCP error response with Error object', async () => {
        const error = new Error('Test error message');
        const operation = 'test operation';
        
        const response = await createMcpErrorResponse(operation, error);
        
        expectValidMcpResponse(response);
        expectMcpError(response, 'test operation');
        
        const parsedData = JSON.parse(response.content[0].text);
        expect(parsedData.error).toBe('Failed to test operation');
        expect(parsedData.message).toBe('Test error message');
        expect(parsedData.timestamp).toBeDefined();
        expect(new Date(parsedData.timestamp)).toBeInstanceOf(Date);
      });

      it('should create valid MCP error response with string error', async () => {
        const error = 'String error message';
        const operation = 'string test';
        
        const response = await createMcpErrorResponse(operation, error);
        
        expectValidMcpResponse(response);
        expectMcpError(response);
        
        const parsedData = JSON.parse(response.content[0].text);
        expect(parsedData.error).toBe('Failed to string test');
        expect(parsedData.message).toBe('String error message');
      });

      it('should create valid MCP error response with unknown error type', async () => {
        const error = { custom: 'error object' };
        const operation = 'unknown error test';
        
        const response = await createMcpErrorResponse(operation, error);
        
        expectValidMcpResponse(response);
        
        const parsedData = JSON.parse(response.content[0].text);
        expect(parsedData.message).toBe('[object Object]');
      });

      it('should include timestamp in error response', async () => {
        const before = new Date();
        const response = await createMcpErrorResponse('test', new Error('test'));
        const after = new Date();
        
        const parsedData = JSON.parse(response.content[0].text);
        const timestamp = new Date(parsedData.timestamp);
        
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
      });
    });
  });

  describe('Schema Validation', () => {
    describe('paginationSchema', () => {
      it('should validate valid pagination parameters', () => {
        const validPagination = { limit: 10, offset: 0 };
        const result = paginationSchema.parse(validPagination);
        
        expect(result).toEqual(validPagination);
      });

      it('should apply default values', () => {
        const result = paginationSchema.parse({});
        
        expect(result).toEqual({ limit: 50, offset: 0 });
      });

      it('should validate limit bounds', () => {
        expect(() => paginationSchema.parse({ limit: 0 })).toThrow();
        expect(() => paginationSchema.parse({ limit: 1001 })).toThrow();
        expect(() => paginationSchema.parse({ limit: -1 })).toThrow();
        
        // Valid bounds
        expect(paginationSchema.parse({ limit: 1 })).toEqual({ limit: 1, offset: 0 });
        expect(paginationSchema.parse({ limit: 1000 })).toEqual({ limit: 1000, offset: 0 });
      });

      it('should validate offset bounds', () => {
        expect(() => paginationSchema.parse({ offset: -1 })).toThrow();
        
        // Valid offset
        expect(paginationSchema.parse({ offset: 0 })).toEqual({ limit: 50, offset: 0 });
        expect(paginationSchema.parse({ offset: 100 })).toEqual({ limit: 50, offset: 100 });
      });

      it('should reject non-integer values', () => {
        expect(() => paginationSchema.parse({ limit: 10.5 })).toThrow();
        expect(() => paginationSchema.parse({ offset: 5.5 })).toThrow();
        expect(() => paginationSchema.parse({ limit: 'ten' })).toThrow();
      });
    });

    describe('sortSchema', () => {
      it('should validate valid sort parameters', () => {
        const validSort = { column: 'name', direction: 'ASC' as const };
        const result = sortSchema.parse(validSort);
        
        expect(result).toEqual(validSort);
      });

      it('should apply default direction', () => {
        const result = sortSchema.parse({ column: 'name' });
        
        expect(result).toEqual({ column: 'name', direction: 'ASC' });
      });

      it('should validate direction enum', () => {
        expect(sortSchema.parse({ column: 'name', direction: 'ASC' }))
          .toEqual({ column: 'name', direction: 'ASC' });
        expect(sortSchema.parse({ column: 'name', direction: 'DESC' }))
          .toEqual({ column: 'name', direction: 'DESC' });
        
        expect(() => sortSchema.parse({ column: 'name', direction: 'INVALID' })).toThrow();
      });

      it('should require column name', () => {
        expect(() => sortSchema.parse({})).toThrow();
        expect(() => sortSchema.parse({ column: '' })).toThrow();
        expect(() => sortSchema.parse({ direction: 'ASC' })).toThrow();
      });

      it('should validate column name length', () => {
        expect(sortSchema.parse({ column: 'a' })).toEqual({ column: 'a', direction: 'ASC' });
        expect(() => sortSchema.parse({ column: '' })).toThrow();
      });
    });
  });

  describe('Identifier Validation', () => {
    describe('validateIdentifier', () => {
      it('should validate correct identifiers', () => {
        expect(validateIdentifier('users')).toBe(true);
        expect(validateIdentifier('user_table')).toBe(true);
        expect(validateIdentifier('User123')).toBe(true);
        expect(validateIdentifier('_private')).toBe(true);
        expect(validateIdentifier('table$special')).toBe(true);
        expect(validateIdentifier('a')).toBe(true);
      });

      it('should reject identifiers starting with numbers', () => {
        expect(validateIdentifier('123table')).toBe(false);
        expect(validateIdentifier('9users')).toBe(false);
      });

      it('should reject identifiers with invalid characters', () => {
        expect(validateIdentifier('user-table')).toBe(false);
        expect(validateIdentifier('user.table')).toBe(false);
        expect(validateIdentifier('user table')).toBe(false);
        expect(validateIdentifier('user@table')).toBe(false);
        expect(validateIdentifier('user#table')).toBe(false);
      });

      it('should reject empty identifiers', () => {
        expect(validateIdentifier('')).toBe(false);
      });

      it('should reject identifiers longer than 63 characters', () => {
        const longIdentifier = 'a'.repeat(64);
        const validIdentifier = 'a'.repeat(63);
        
        expect(validateIdentifier(longIdentifier)).toBe(false);
        expect(validateIdentifier(validIdentifier)).toBe(true);
      });

      it('should handle special PostgreSQL cases', () => {
        expect(validateIdentifier('select')).toBe(true); // Keywords are allowed as identifiers
        expect(validateIdentifier('table')).toBe(true);
        expect(validateIdentifier('order')).toBe(true);
      });
    });

    describe('sanitizeIdentifier', () => {
      it('should return valid identifiers unchanged', () => {
        expect(sanitizeIdentifier('users')).toBe('users');
        expect(sanitizeIdentifier('user_table')).toBe('user_table');
        expect(sanitizeIdentifier('User123')).toBe('User123');
      });

      it('should throw error for invalid identifiers', () => {
        expect(() => sanitizeIdentifier('123table')).toThrow('Invalid identifier: 123table');
        expect(() => sanitizeIdentifier('user-table')).toThrow('Invalid identifier: user-table');
        expect(() => sanitizeIdentifier('')).toThrow('Invalid identifier: ');
        expect(() => sanitizeIdentifier('user table')).toThrow('Invalid identifier: user table');
      });

      it('should throw error for identifiers that are too long', () => {
        const longIdentifier = 'a'.repeat(64);
        expect(() => sanitizeIdentifier(longIdentifier))
          .toThrow(`Invalid identifier: ${longIdentifier}`);
      });
    });
  });

  describe('Connection Management', () => {
    describe('testConnection', () => {
      it('should return true for successful connection', async () => {
        const result = await testConnection();
        expect(result).toBe(true);
      });

      it('should handle connection with actual database', async () => {
        // This test verifies the connection works with our test database
        const result = await testConnection();
        expect(result).toBe(true);
        
        // Verify we can actually query the database
        const queryResult = await executePostgresQuery('SELECT 1 as test');
        expect(queryResult).toHaveLength(1);
        expect(queryResult[0].test).toBe(1);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // This test might be environment-specific, but tests error handling
      await expect(
        executePostgresQuery('SELECT * FROM nonexistent_table')
      ).rejects.toThrow(/Database query failed/);
    });

    it('should handle malformed SQL gracefully', async () => {
      await expect(
        executePostgresQuery('SELECT FROM WHERE')
      ).rejects.toThrow(/Database query failed/);
    });

    it('should handle parameter mismatch', async () => {
      await expect(
        executePostgresQuery('SELECT * FROM users WHERE id = $1 AND name = $2', [1])
      ).rejects.toThrow(/Database query failed/);
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle multiple concurrent queries', async () => {
      await insertTestData();
      
      const queries = Array.from({ length: 10 }, (_, i) => 
        executePostgresQuery('SELECT * FROM users WHERE id = $1', [i + 1])
      );
      
      const results = await Promise.all(queries);
      expect(results).toHaveLength(10);
      
      // Results should be arrays (empty or with data)
      results.forEach(result => {
        expect(Array.isArray(result)).toBe(true);
      });
    });

    it('should release connections properly', async () => {
      // Execute multiple queries to test connection pooling
      for (let i = 0; i < 5; i++) {
        await executePostgresQuery('SELECT $1 as iteration', [i]);
      }
      
      // Verify pool is still functional
      const result = await executePostgresQuery('SELECT 1 as final_test');
      expect(result[0].final_test).toBe(1);
    });
  });
});