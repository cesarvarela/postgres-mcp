import { describe, it, expect, beforeEach } from 'vitest';
import {
  executePostgresQuery,
  testConnection,
} from '../../tools/utils';
import { getTestPool } from '../setup/test-setup';

describe('Database Utils - Database Tests', () => {
  async function cleanTestData() {
    const pool = getTestPool();
    const client = await pool.connect();
    
    try {
      await client.query('TRUNCATE orders, products, users RESTART IDENTITY CASCADE');
    } finally {
      client.release();
    }
  }

  async function insertTestData() {
    const pool = getTestPool();
    const client = await pool.connect();
    
    try {
      // Insert test users
      const userResult = await client.query(`
        INSERT INTO users (email, name, age, is_active, metadata, tags) VALUES
        ('john@example.com', 'John Doe', 30, true, '{"role": "admin"}', ARRAY['developer', 'admin']),
        ('jane@example.com', 'Jane Smith', 25, true, '{"role": "user"}', ARRAY['user'])
        RETURNING id
      `);
      
      return { users: userResult.rows };
    } finally {
      client.release();
    }
  }

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

    it('should handle JSONB data types', async () => {
      await insertTestData();
      
      const result = await executePostgresQuery(
        'SELECT metadata FROM users WHERE email = $1',
        ['john@example.com']
      );
      
      expect(result).toHaveLength(1);
      expect(typeof result[0].metadata).toBe('object');
      expect(result[0].metadata.role).toBe('admin');
    });

    it('should handle array data types', async () => {
      await insertTestData();
      
      const result = await executePostgresQuery(
        'SELECT tags FROM users WHERE email = $1',
        ['john@example.com']
      );
      
      expect(result).toHaveLength(1);
      expect(Array.isArray(result[0].tags)).toBe(true);
      expect(result[0].tags).toContain('developer');
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
      
      const queries = Array.from({ length: 5 }, (_, i) => 
        executePostgresQuery('SELECT $1 as iteration', [i])
      );
      
      const results = await Promise.all(queries);
      expect(results).toHaveLength(5);
      
      // Results should be arrays with the iteration number
      results.forEach((result, index) => {
        expect(Array.isArray(result)).toBe(true);
        expect(result[0].iteration).toBe(index.toString()); // PostgreSQL returns strings for parameters
      });
    });

    it('should release connections properly', async () => {
      // Execute multiple queries to test connection pooling
      for (let i = 0; i < 3; i++) {
        await executePostgresQuery('SELECT $1 as iteration', [i]);
      }
      
      // Verify pool is still functional
      const result = await executePostgresQuery('SELECT 1 as final_test');
      expect(result[0].final_test).toBe(1);
    });
  });
});