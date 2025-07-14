import { describe, it, expect, beforeEach } from 'vitest';
import { queryTable } from '../../tools/queryTable';
import { executeQuery } from '../../tools/executeQuery';
import { getTestPool } from '../setup/test-setup';

describe('SQL Injection Security Tests', () => {
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
      await client.query(`
        INSERT INTO users (email, name, age, is_active) VALUES
        ('test@example.com', 'Test User', 30, true),
        ('admin@example.com', 'Admin User', 35, true)
      `);
    } finally {
      client.release();
    }
  }

  function expectMcpError(response: any): void {
    expect(response).toBeDefined();
    expect(response.content[0].text.toLowerCase()).toMatch(/error|failed|invalid/);
  }

  beforeEach(async () => {
    await cleanTestData();
    await insertTestData();
  });

  describe('queryTable Tool SQL Injection Protection', () => {
    const sqlInjectionPayloads = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "'; DELETE FROM users WHERE '1'='1'; --",
      "' UNION SELECT * FROM users --",
      "'; INSERT INTO users (email) VALUES ('hacked'); --",
      "' OR 1=1; --",
      "admin'--",
      "admin'/*",
      "' OR 'x'='x",
      "') OR ('1'='1",
    ];

    it('should prevent SQL injection in table names', async () => {
      for (const payload of sqlInjectionPayloads) {
        const response = await queryTable({ table: payload });
        expectMcpError(response);
      }
    });

    it('should prevent SQL injection in column names', async () => {
      for (const payload of sqlInjectionPayloads) {
        const response = await queryTable({ 
          table: 'users',
          columns: [payload]
        });
        expectMcpError(response);
      }
    });

    it('should prevent SQL injection in sort column', async () => {
      for (const payload of sqlInjectionPayloads) {
        const response = await queryTable({ 
          table: 'users',
          sort: { column: payload }
        });
        expectMcpError(response);
      }
    });

    it('should prevent SQL injection in WHERE column names', async () => {
      for (const payload of sqlInjectionPayloads) {
        const response = await queryTable({ 
          table: 'users',
          where: { [payload]: 'value' }
        });
        expectMcpError(response);
      }
    });

    it('should safely handle SQL injection in WHERE values', async () => {
      // WHERE values should be parameterized and safe
      for (const payload of sqlInjectionPayloads) {
        const response = await queryTable({ 
          table: 'users',
          where: { email: payload }
        });
        
        // Should not error (values are parameterized), but should return no results
        expect(response).toBeDefined();
        const data = JSON.parse(response.content[0].text);
        expect(data.count).toBe(0);
        expect(data.data).toEqual([]);
      }
    });

    it('should safely handle SQL injection in array WHERE values', async () => {
      const payload = "'; DROP TABLE users; --";
      const response = await queryTable({ 
        table: 'users',
        where: { email: [payload, 'test@example.com'] }
      });
      
      // Should return only the legitimate email
      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.count).toBe(1);
      expect(data.data[0].email).toBe('test@example.com');
    });

    it('should safely handle SQL injection in LIKE patterns', async () => {
      const payload = "'; DROP TABLE users; --";
      const response = await queryTable({ 
        table: 'users',
        where: { email: `%${payload}%` }
      });
      
      // Should not error but return no results
      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.count).toBe(0);
    });
  });

  describe('executeQuery Tool SQL Injection Protection', () => {
    it('should prevent dangerous SQL operations', async () => {
      const dangerousQueries = [
        'DROP TABLE users',
        'DELETE FROM users',
        'UPDATE users SET email = \'hacked\'',
        'INSERT INTO users (email) VALUES (\'hacked\')',
        'TRUNCATE TABLE users',
        'ALTER TABLE users ADD COLUMN hacked TEXT',
        'CREATE TABLE hacked (id INTEGER)',
      ];

      for (const query of dangerousQueries) {
        const response = await executeQuery({ query });
        expectMcpError(response);
      }
    });

    it('should allow safe parameterized queries', async () => {
      const response = await executeQuery({ 
        query: 'SELECT * FROM users WHERE email = $1',
        params: ['test@example.com']
      });
      
      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.success).toBe(true);
      expect(data.results.length).toBe(1);
    });

    it('should prevent SQL injection through parameters', async () => {
      // Even if someone tries to inject SQL through parameters, it should be safe
      const response = await executeQuery({ 
        query: 'SELECT * FROM users WHERE email = $1',
        params: ["'; DROP TABLE users; --"]
      });
      
      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.success).toBe(true);
      expect(data.results.length).toBe(0); // No results for the malicious string
    });

    it('should prevent nested injection attempts', async () => {
      const response = await executeQuery({ 
        query: 'SELECT * FROM users WHERE name = $1 AND email = $2',
        params: [
          "Test'; DROP TABLE users; --",
          "test@example.com'; DELETE FROM users; --"
        ]
      });
      
      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.success).toBe(true);
      expect(data.results.length).toBe(0); // No legitimate match
    });
  });

  describe('Identifier Validation', () => {
    it('should reject table names with SQL injection patterns', async () => {
      const invalidIdentifiers = [
        'users; DROP TABLE products',
        'users/*comment*/',
        'users--comment',
        'users OR 1=1',
        'users\'; DROP TABLE',
        '1users', // starts with number
        'user-table', // contains hyphen
        'user.table', // contains dot
        'user table', // contains space
      ];

      for (const identifier of invalidIdentifiers) {
        const response = await queryTable({ table: identifier });
        expectMcpError(response);
      }
    });

    it('should reject column names with SQL injection patterns', async () => {
      const invalidIdentifiers = [
        'id; DROP TABLE users',
        'id/*comment*/',
        'id--comment',
        'id OR 1=1',
        '1id',
        'col-name',
        'col.name',
        'col name',
      ];

      for (const identifier of invalidIdentifiers) {
        const response = await queryTable({ 
          table: 'users',
          columns: [identifier]
        });
        expectMcpError(response);
      }
    });

    it('should allow valid PostgreSQL identifiers', async () => {
      const validIdentifiers = [
        'users',
        'user_table',
        'User123',
        '_private',
        'table$special',
      ];

      for (const identifier of validIdentifiers) {
        // This will fail because the tables don't exist, but should not fail due to identifier validation
        const response = await queryTable({ table: identifier });
        
        // Should get a "table doesn't exist" error, not an "invalid identifier" error
        expect(response).toBeDefined();
        const text = response.content[0].text.toLowerCase();
        expect(text).not.toMatch(/invalid identifier/);
      }
    });
  });

  describe('Data Integrity', () => {
    it('should not allow modification of data through query parameters', async () => {
      // Verify initial state
      const initialResponse = await queryTable({ table: 'users' });
      const initialData = JSON.parse(initialResponse.content[0].text);
      const initialCount = initialData.count;

      // Try various injection attempts
      await queryTable({ 
        table: 'users',
        where: { 
          email: "test@example.com'; DELETE FROM users WHERE '1'='1"
        }
      });

      // Verify data integrity
      const finalResponse = await queryTable({ table: 'users' });
      const finalData = JSON.parse(finalResponse.content[0].text);
      expect(finalData.count).toBe(initialCount);
    });

    it('should not allow data exfiltration through error messages', async () => {
      const response = await queryTable({ table: 'nonexistent_table' });
      
      expectMcpError(response);
      const errorText = response.content[0].text;
      
      // Error should not reveal sensitive database information
      expect(errorText).not.toMatch(/password|secret|key|token/i);
      expect(errorText).not.toMatch(/database.*user|connection.*string/i);
    });
  });

  describe('Performance and Resource Protection', () => {
    it('should handle large WHERE clause arrays safely', async () => {
      // Create a large array that could potentially cause issues
      const largeArray = Array.from({ length: 1000 }, (_, i) => `email${i}@example.com`);
      
      const response = await queryTable({ 
        table: 'users',
        where: { email: largeArray }
      });
      
      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.count).toBe(0); // No matches expected
    });

    it('should handle complex nested JSON safely', async () => {
      const complexJson = {
        nested: {
          deep: {
            object: {
              with: {
                many: {
                  levels: "'; DROP TABLE users; --"
                }
              }
            }
          }
        }
      };

      const response = await queryTable({ 
        table: 'users',
        where: { metadata: JSON.stringify(complexJson) }
      });
      
      expect(response).toBeDefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.count).toBe(0); // No matches expected
    });
  });
});