import { describe, it, expect, beforeEach } from 'vitest';
import { executeQuery, executeQuerySchema } from '../../../tools/executeQuery';
import { cleanTestData, getTestPool, insertTestData } from '../../setup/test-setup';
import { executeTestQuery, expectMcpError, expectValidMcpResponse, extractJsonFromMcpResponse } from '../../setup/test-helpers';

describe('executeQuery Tool', () => {
  beforeEach(async () => {
    await cleanTestData();
    await insertTestData(); // Ensure we have data to query
  });

  describe('Schema Validation', () => {
    it('should validate minimal valid parameters', () => {
      const params = { 
        query: 'SELECT 1'
      };
      const result = executeQuerySchema.parse(params);
      
      expect(result.query).toBe('SELECT 1');
      expect(result.params).toEqual([]); // default
      expect(result.explain).toBe(false); // default
    });

    it('should validate complete parameters', () => {
      const params = {
        query: 'SELECT * FROM users WHERE id = $1',
        params: [1],
        explain: true
      };
      
      const result = executeQuerySchema.parse(params);
      expect(result).toEqual(params);
    });

    it('should reject empty query', () => {
      expect(() => executeQuerySchema.parse({ 
        query: ''
      })).toThrow();
    });

    it('should apply default values', () => {
      const params = { query: 'SELECT * FROM users' };
      const result = executeQuerySchema.parse(params);
      
      expect(result.params).toEqual([]);
      expect(result.explain).toBe(false);
    });
  });

  describe('Basic Query Execution', () => {
    it('should execute simple SELECT query', async () => {
      const response = await executeQuery({
        query: 'SELECT 1 as test_value, \'hello\' as test_string'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.query_type).toBe('SELECT');
      expect(data.row_count).toBe(1);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].test_value).toBe(1);
      expect(data.data[0].test_string).toBe('hello');
      expect(data.executed_at).toBeDefined();
      expect(typeof data.execution_time_ms).toBe('number');
    });

    it('should execute SELECT query on users table', async () => {
      const response = await executeQuery({
        query: 'SELECT id, email, name FROM users ORDER BY id LIMIT 5'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.query_type).toBe('SELECT');
      expect(data.row_count).toBeGreaterThan(0);
      expect(data.data.length).toBeGreaterThan(0);
      
      // Verify structure of returned data
      data.data.forEach((row: any) => {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('email');
        expect(row).toHaveProperty('name');
      });
    });

    it('should handle queries with no results', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users WHERE id = 99999'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.query_type).toBe('SELECT');
      expect(data.row_count).toBe(0);
      expect(data.data).toEqual([]);
    });
  });

  describe('Parameterized Queries', () => {
    it('should execute query with parameters', async () => {
      // First get a user ID to use in the test
      const users = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const userId = users[0].id;
      
      const response = await executeQuery({
        query: 'SELECT id, email, name FROM users WHERE id = $1',
        params: [userId]
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.row_count).toBe(1);
      expect(data.data[0].id).toBe(userId);
    });

    it('should handle multiple parameters', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users WHERE is_active = $1 AND age >= $2 ORDER BY id LIMIT $3',
        params: [true, 18, 5]
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.query_type).toBe('SELECT');
      expect(data.data.length).toBeLessThanOrEqual(5);
      
      // Verify the filter conditions
      data.data.forEach((row: any) => {
        expect(row.is_active).toBe(true);
        if (row.age !== null) {
          expect(row.age).toBeGreaterThanOrEqual(18);
        }
      });
    });

    it('should handle string parameters', async () => {
      const response = await executeQuery({
        query: 'SELECT id, email FROM users WHERE email LIKE $1',
        params: ['%@example.com']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      data.data.forEach((row: any) => {
        expect(row.email).toMatch(/@example\.com$/);
      });
    });

    it('should handle null parameters', async () => {
      const response = await executeQuery({
        query: 'SELECT id, email, age FROM users WHERE age IS NULL OR age = $1',
        params: [null]
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      // This query should work without errors
    });
  });

  describe('Query Types', () => {
    it('should identify SELECT queries', async () => {
      const response = await executeQuery({
        query: 'SELECT COUNT(*) as user_count FROM users'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.query_type).toBe('SELECT');
    });

    it('should identify different query types by their structure', async () => {
      // Test different query patterns
      const queries = [
        { query: 'select * from users limit 1', expected: 'SELECT' },
        { query: '  SELECT id FROM users  ', expected: 'SELECT' },
        { query: '\nSELECT\n*\nFROM users', expected: 'SELECT' }
      ];
      
      for (const testCase of queries) {
        const response = await executeQuery({
          query: testCase.query
        });
        
        expectValidMcpResponse(response);
        const data = extractJsonFromMcpResponse(response);
        expect(data.query_type).toBe(testCase.expected);
      }
    });
  });

  describe('EXPLAIN Functionality', () => {
    it('should include execution plan when explain is true', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users WHERE is_active = true',
        explain: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.execution_plan).toBeDefined();
      expect(Array.isArray(data.execution_plan)).toBe(true);
    });

    it('should not include execution plan by default', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users WHERE is_active = true'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.execution_plan).toBeUndefined();
    });

    it('should handle explain for complex queries', async () => {
      const response = await executeQuery({
        query: `
          SELECT u.id, u.email, u.name, u.age 
          FROM users u 
          WHERE u.is_active = true 
          ORDER BY u.created_at DESC 
          LIMIT 10
        `,
        explain: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.execution_plan).toBeDefined();
    });

    it('should continue execution even if explain fails', async () => {
      // Use a query that might have explain issues but should still execute
      const response = await executeQuery({
        query: 'SELECT NOW()',
        explain: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      // execution_plan may or may not be present depending on explain success
    });
  });

  describe('Security Features', () => {
    it('should reject DROP TABLE queries', async () => {
      const response = await executeQuery({
        query: 'DROP TABLE users'
      });
      
      expectMcpError(response, /dangerous.*operation/i);
    });

    it('should reject DROP DATABASE queries', async () => {
      const response = await executeQuery({
        query: 'DROP DATABASE testdb'
      });
      
      expectMcpError(response, /dangerous.*operation/i);
    });

    it('should reject TRUNCATE TABLE queries', async () => {
      const response = await executeQuery({
        query: 'TRUNCATE TABLE users'
      });
      
      expectMcpError(response, /dangerous.*operation/i);
    });

    it('should reject CREATE TABLE queries', async () => {
      const response = await executeQuery({
        query: 'CREATE TABLE test_table (id INT)'
      });
      
      expectMcpError(response, /dangerous.*operation/i);
    });

    it('should reject INSERT queries', async () => {
      const response = await executeQuery({
        query: 'INSERT INTO users (email, name) VALUES (\'test@example.com\', \'Test User\')'
      });
      
      expectMcpError(response, /dangerous.*operation/i);
    });

    it('should reject DELETE without WHERE', async () => {
      const response = await executeQuery({
        query: 'DELETE FROM users'
      });
      
      expectMcpError(response, /delete.*without.*where/i);
    });

    it('should reject UPDATE without WHERE', async () => {
      const response = await executeQuery({
        query: 'UPDATE users SET name = \'Updated\''
      });
      
      expectMcpError(response, /update.*without.*where/i);
    });

    it('should reject ALTER TABLE ADD queries', async () => {
      const response = await executeQuery({
        query: 'ALTER TABLE users ADD COLUMN new_column TEXT'
      });
      
      expectMcpError(response, /dangerous.*operation/i);
    });

    it('should reject ALTER TABLE DROP queries', async () => {
      const response = await executeQuery({
        query: 'ALTER TABLE users DROP COLUMN name'
      });
      
      expectMcpError(response, /dangerous.*operation/i);
    });

    it('should handle case-insensitive dangerous patterns', async () => {
      const dangerousQueries = [
        'drop table users',
        'DROP TABLE users',
        'Drop Table users',
        'dRoP tAbLe users'
      ];
      
      for (const query of dangerousQueries) {
        const response = await executeQuery({ query });
        expectMcpError(response, /dangerous.*operation/i);
      }
    });
  });

  describe('Complex Queries', () => {
    it('should handle JOINs and subqueries', async () => {
      const response = await executeQuery({
        query: `
          SELECT 
            u1.id,
            u1.email,
            u1.name,
            (SELECT COUNT(*) FROM users u2 WHERE u2.is_active = u1.is_active) as same_status_count
          FROM users u1
          WHERE u1.is_active = true
          ORDER BY u1.id
          LIMIT 3
        `
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.data.length).toBeLessThanOrEqual(3);
      
      data.data.forEach((row: any) => {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('email');
        expect(row).toHaveProperty('name');
        expect(row).toHaveProperty('same_status_count');
        expect(typeof row.same_status_count).toBe('number');
      });
    });

    it('should handle aggregate functions', async () => {
      const response = await executeQuery({
        query: `
          SELECT 
            COUNT(*) as total_users,
            COUNT(CASE WHEN is_active THEN 1 END) as active_users,
            AVG(CASE WHEN age IS NOT NULL THEN age END) as avg_age,
            MIN(created_at) as earliest_created,
            MAX(created_at) as latest_created
          FROM users
        `
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.row_count).toBe(1);
      
      const stats = data.data[0];
      expect(typeof stats.total_users).toBe('number');
      expect(typeof stats.active_users).toBe('number');
      expect(stats.total_users).toBeGreaterThanOrEqual(stats.active_users);
    });

    it('should handle window functions', async () => {
      const response = await executeQuery({
        query: `
          SELECT 
            id,
            email,
            name,
            ROW_NUMBER() OVER (ORDER BY created_at) as row_num,
            RANK() OVER (ORDER BY age DESC NULLS LAST) as age_rank
          FROM users
          ORDER BY id
          LIMIT 5
        `
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.data.length).toBeLessThanOrEqual(5);
      
      data.data.forEach((row: any) => {
        expect(typeof row.row_num).toBe('number');
        expect(typeof row.age_rank).toBe('number');
      });
    });

    it('should handle CTEs (Common Table Expressions)', async () => {
      const response = await executeQuery({
        query: `
          WITH active_users AS (
            SELECT id, email, name, age
            FROM users
            WHERE is_active = true
          ),
          user_stats AS (
            SELECT 
              COUNT(*) as count,
              AVG(age) as avg_age
            FROM active_users
            WHERE age IS NOT NULL
          )
          SELECT * FROM user_stats
        `
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.row_count).toBe(1);
      
      const stats = data.data[0];
      expect(typeof stats.count).toBe('number');
    });
  });

  describe('Data Types', () => {
    it('should handle various PostgreSQL data types', async () => {
      const response = await executeQuery({
        query: `
          SELECT 
            id,
            email,
            name,
            age,
            is_active,
            metadata,
            tags,
            created_at
          FROM users
          LIMIT 1
        `
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      if (data.data.length > 0) {
        const row = data.data[0];
        
        // Verify data types
        expect(typeof row.id).toBe('number');
        expect(typeof row.email).toBe('string');
        expect(typeof row.name).toBe('string');
        expect(typeof row.is_active).toBe('boolean');
        
        // age can be null or number
        if (row.age !== null) {
          expect(typeof row.age).toBe('number');
        }
        
        // metadata can be null or object
        if (row.metadata !== null) {
          expect(typeof row.metadata).toBe('object');
        }
        
        // tags can be null or array
        if (row.tags !== null) {
          expect(Array.isArray(row.tags)).toBe(true);
        }
        
        // created_at should be a string (ISO timestamp)
        expect(typeof row.created_at).toBe('string');
      }
    });

    it('should handle JSON operations', async () => {
      const response = await executeQuery({
        query: `
          SELECT 
            id,
            email,
            metadata,
            metadata->>'role' as role,
            CASE 
              WHEN metadata IS NOT NULL THEN jsonb_typeof(metadata)
              ELSE 'null'
            END as metadata_type
          FROM users
          WHERE metadata IS NOT NULL
          LIMIT 3
        `
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      
      data.data.forEach((row: any) => {
        expect(row.metadata_type).toBe('object');
        if (row.metadata && row.metadata.role) {
          expect(typeof row.role).toBe('string');
        }
      });
    });

    it('should handle array operations', async () => {
      const response = await executeQuery({
        query: `
          SELECT 
            id,
            email,
            tags,
            array_length(tags, 1) as tag_count,
            CASE 
              WHEN tags IS NOT NULL AND array_length(tags, 1) > 0 
              THEN tags[1] 
              ELSE NULL 
            END as first_tag
          FROM users
          WHERE tags IS NOT NULL
          LIMIT 3
        `
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      
      data.data.forEach((row: any) => {
        if (row.tag_count && row.tag_count > 0) {
          expect(typeof row.first_tag).toBe('string');
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle syntax errors gracefully', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users WHERE invalid syntax'
      });
      
      expectMcpError(response, /execute query/);
    });

    it('should handle non-existent table errors', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM nonexistent_table'
      });
      
      expectMcpError(response, /execute query/);
    });

    it('should handle non-existent column errors', async () => {
      const response = await executeQuery({
        query: 'SELECT nonexistent_column FROM users'
      });
      
      expectMcpError(response, /execute query/);
    });

    it('should handle parameter mismatch errors', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users WHERE id = $1 AND email = $2',
        params: [1] // Missing second parameter
      });
      
      expectMcpError(response, /execute query/);
    });

    it('should handle type mismatch errors', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users WHERE id = $1',
        params: ['not_a_number'] // String where number expected
      });
      
      expectMcpError(response, /execute query/);
    });
  });

  describe('Performance', () => {
    it('should track execution time', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users ORDER BY id LIMIT 10'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(typeof data.execution_time_ms).toBe('number');
      expect(data.execution_time_ms).toBeGreaterThan(0);
      expect(data.execution_time_ms).toBeLessThan(10000); // Should be less than 10 seconds
    });

    it('should handle queries efficiently', async () => {
      const startTime = Date.now();
      
      const response = await executeQuery({
        query: 'SELECT COUNT(*) as total FROM users'
      });
      
      const totalTime = Date.now() - startTime;
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(totalTime).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty result sets', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users WHERE 1 = 0'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.row_count).toBe(0);
      expect(data.data).toEqual([]);
    });

    it('should handle very long strings in results', async () => {
      const longString = 'A'.repeat(1000);
      const response = await executeQuery({
        query: 'SELECT $1 as long_string',
        params: [longString]
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.data[0].long_string).toBe(longString);
    });

    it('should handle queries with special characters', async () => {
      const response = await executeQuery({
        query: 'SELECT \'Hello "World" with \'\'quotes\'\'\' as special_string'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.data[0].special_string).toBe('Hello "World" with \'quotes\'');
    });

    it('should handle unicode characters', async () => {
      const response = await executeQuery({
        query: 'SELECT \'测试 🚀 こんにちは\' as unicode_string'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.success).toBe(true);
      expect(data.data[0].unicode_string).toBe('测试 🚀 こんにちは');
    });
  });

  describe('Response Format', () => {
    it('should have consistent response structure', async () => {
      const response = await executeQuery({
        query: 'SELECT * FROM users LIMIT 1'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Verify required fields
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('query_type');
      expect(data).toHaveProperty('execution_time_ms');
      expect(data).toHaveProperty('row_count');
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('executed_at');
      
      // Verify data types
      expect(typeof data.success).toBe('boolean');
      expect(typeof data.query_type).toBe('string');
      expect(typeof data.execution_time_ms).toBe('number');
      expect(typeof data.row_count).toBe('number');
      expect(Array.isArray(data.data)).toBe(true);
      expect(typeof data.executed_at).toBe('string');
      
      // Verify timestamp format
      expect(new Date(data.executed_at).toISOString()).toBe(data.executed_at);
    });
  });
});