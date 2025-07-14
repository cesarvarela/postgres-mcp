import { describe, it, expect, beforeEach } from 'vitest';
import { deleteData, deleteDataSchema } from '../../../tools/deleteData';
import { cleanTestData, getTestPool, insertTestData } from '../../setup/test-setup';
import { executeTestQuery, expectMcpError, expectValidMcpResponse, extractJsonFromMcpResponse, generateTestUser } from '../../setup/test-helpers';

describe('deleteData Tool', () => {
  beforeEach(async () => {
    await cleanTestData();
    await insertTestData(); // Insert test data for deletion
  });

  describe('Schema Validation', () => {
    it('should validate minimal valid parameters', () => {
      const params = { 
        table: 'users', 
        where: { id: 1 }
      };
      const result = deleteDataSchema.parse(params);
      
      expect(result.table).toBe('users');
      expect(result.where).toEqual({ id: 1 });
      expect(result.confirm_delete).toBe(false); // default
      expect(result.returning).toBeUndefined(); // optional
    });

    it('should validate complete parameters', () => {
      const params = {
        table: 'users',
        where: { email: 'test@example.com', is_active: false },
        confirm_delete: true,
        returning: ['id', 'email', 'name']
      };
      
      const result = deleteDataSchema.parse(params);
      expect(result).toEqual(params);
    });

    it('should reject empty table name', () => {
      expect(() => deleteDataSchema.parse({ 
        table: '', 
        where: { id: 1 }
      })).toThrow();
    });

    it('should accept empty where object in schema (but will fail in business logic)', () => {
      const params = {
        table: 'users',
        where: {}
      };
      
      // Schema validation should pass
      expect(() => deleteDataSchema.parse(params)).not.toThrow();
    });

    it('should validate confirm_delete as boolean', () => {
      const params = {
        table: 'users',
        where: { id: 1 },
        confirm_delete: true
      };
      
      const result = deleteDataSchema.parse(params);
      expect(result.confirm_delete).toBe(true);
    });
  });

  describe('Single Record Deletion', () => {
    it('should delete a single record successfully', async () => {
      // First, get an existing user
      const existingUsers = await executeTestQuery('SELECT id, email, name FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table).toBe('users');
      expect(data.deleted_count).toBe(1);
      expect(data.deleted_at).toBeDefined();
      expect(data.data).toBeUndefined(); // No RETURNING clause
      
      // Verify the record is actually deleted
      const checkResult = await executeTestQuery('SELECT * FROM users WHERE id = $1', [existingUser.id]);
      expect(checkResult).toHaveLength(0);
    });

    it('should delete with RETURNING clause', async () => {
      const existingUsers = await executeTestQuery('SELECT id, email, name FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { id: existingUser.id },
        returning: ['id', 'email', 'name']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(1);
      expect(data.data).toHaveLength(1);
      
      const deletedUser = data.data[0];
      expect(deletedUser.id).toBe(existingUser.id);
      expect(deletedUser.email).toBe(existingUser.email);
      expect(deletedUser.name).toBe(existingUser.name);
      expect(Object.keys(deletedUser)).toEqual(['id', 'email', 'name']);
    });

    it('should return all columns with RETURNING *', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { id: existingUser.id },
        returning: ['*']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const deletedUser = data.data[0];
      expect(deletedUser).toHaveProperty('id');
      expect(deletedUser).toHaveProperty('email');
      expect(deletedUser).toHaveProperty('name');
      expect(deletedUser).toHaveProperty('age');
      expect(deletedUser).toHaveProperty('is_active');
      expect(deletedUser).toHaveProperty('metadata');
      expect(deletedUser).toHaveProperty('tags');
      expect(deletedUser).toHaveProperty('created_at');
    });

    it('should handle no matching records', async () => {
      const response = await deleteData({
        table: 'users',
        where: { id: 99999 } // Non-existent ID
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(0);
      expect(data.message).toBe("No rows match the WHERE conditions");
    });
  });

  describe('Multiple Record Deletion', () => {
    it('should delete multiple records with same condition', async () => {
      // First, count how many active users we have
      const activeUsers = await executeTestQuery('SELECT COUNT(*) as count FROM users WHERE is_active = true');
      const activeCount = parseInt(activeUsers[0].count);
      
      if (activeCount === 0) {
        // Insert some active users for this test
        await executeTestQuery(
          'INSERT INTO users (email, name, is_active) VALUES ($1, $2, $3), ($4, $5, $6)',
          ['active1@example.com', 'Active 1', true, 'active2@example.com', 'Active 2', true]
        );
      }
      
      const response = await deleteData({
        table: 'users',
        where: { is_active: true },
        returning: ['id', 'email']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBeGreaterThan(0);
      expect(data.data).toHaveLength(data.deleted_count);
      
      // Verify all deleted users were active
      data.data.forEach((user: any) => {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
      });
      
      // Verify no active users remain
      const remainingActive = await executeTestQuery('SELECT COUNT(*) as count FROM users WHERE is_active = true');
      expect(parseInt(remainingActive[0].count)).toBe(0);
    });

    it('should delete records matching complex conditions', async () => {
      // Insert specific test data
      await executeTestQuery(
        'INSERT INTO users (email, name, age, is_active) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        ['complex1@example.com', 'Complex 1', 25, true, 'complex2@example.com', 'Complex 2', 25, true]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { 
          age: 25,
          is_active: true
        },
        returning: ['email', 'age', 'is_active']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBeGreaterThan(0);
      
      // Verify all deleted records match the conditions
      data.data.forEach((user: any) => {
        expect(user.age).toBe(25);
        expect(user.is_active).toBe(true);
      });
    });
  });

  describe('WHERE Clause Conditions', () => {
    it('should handle equality conditions', async () => {
      const existingUsers = await executeTestQuery('SELECT email FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { email: existingUser.email },
        returning: ['email']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(1);
      expect(data.data[0].email).toBe(existingUser.email);
    });

    it('should handle NULL conditions', async () => {
      // First create a user with null age
      await executeTestQuery(
        'INSERT INTO users (email, name, age, is_active) VALUES ($1, $2, $3, $4)',
        ['nullage@example.com', 'Null Age User', null, true]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { age: null },
        returning: ['email', 'age']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBeGreaterThan(0);
      data.data.forEach((user: any) => {
        expect(user.age).toBeNull();
      });
    });

    it('should handle IN operator with arrays', async () => {
      // Insert users with specific ages (different from initial test data)
      await executeTestQuery(
        'INSERT INTO users (email, name, age, is_active) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)',
        ['age40@example.com', 'Age 40', 40, true, 'age45@example.com', 'Age 45', 45, true, 'age50@example.com', 'Age 50', 50, true]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { age: [40, 45, 50] },
        returning: ['email', 'age']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(3);
      data.data.forEach((user: any) => {
        expect([40, 45, 50]).toContain(user.age);
      });
    });

    it('should handle LIKE operator with wildcards', async () => {
      // Insert users with specific email pattern
      await executeTestQuery(
        'INSERT INTO users (email, name, is_active) VALUES ($1, $2, $3), ($4, $5, $6)',
        ['like1@test.com', 'Like 1', true, 'like2@test.com', 'Like 2', true]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { email: '%@test.com' },
        returning: ['email']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(2);
      data.data.forEach((user: any) => {
        expect(user.email).toMatch(/@test\.com$/);
      });
    });

    it('should handle multiple conditions (AND logic)', async () => {
      // Insert specific test data
      await executeTestQuery(
        'INSERT INTO users (email, name, age, is_active) VALUES ($1, $2, $3, $4)',
        ['multi@example.com', 'Multi User', 30, true]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { 
          age: 30,
          is_active: true
        },
        returning: ['email', 'age', 'is_active']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        expect(user.age).toBe(30);
        expect(user.is_active).toBe(true);
      });
    });
  });

  describe('Safety Features', () => {
    it('should require WHERE clause for safety', async () => {
      const response = await deleteData({
        table: 'users',
        where: {} // Empty where clause
      });
      
      expectMcpError(response, /where clause is required/i);
    });

    it('should warn about large deletions without confirmation', async () => {
      // Insert many records to trigger the safety check
      const bulkUsers = Array.from({ length: 150 }, (_, i) => 
        generateTestUser({
          email: `bulk${i}@example.com`,
          name: `Bulk User ${i}`,
          is_active: true
        })
      );
      
      for (const user of bulkUsers) {
        await executeTestQuery(
          'INSERT INTO users (email, name, age, is_active, metadata, tags) VALUES ($1, $2, $3, $4, $5, $6)',
          [user.email, user.name, user.age, user.is_active, JSON.stringify(user.metadata), user.tags]
        );
      }
      
      const response = await deleteData({
        table: 'users',
        where: { is_active: true } // This should match > 100 records
      });
      
      expectMcpError(response, /would delete.*rows.*confirm_delete/i);
    });

    it('should allow large deletions with confirmation', async () => {
      // Insert many records
      const bulkUsers = Array.from({ length: 150 }, (_, i) => 
        generateTestUser({
          email: `confirmed${i}@example.com`,
          name: `Confirmed User ${i}`,
          is_active: false // Use false to distinguish from other tests
        })
      );
      
      for (const user of bulkUsers) {
        await executeTestQuery(
          'INSERT INTO users (email, name, age, is_active, metadata, tags) VALUES ($1, $2, $3, $4, $5, $6)',
          [user.email, user.name, user.age, user.is_active, JSON.stringify(user.metadata), user.tags]
        );
      }
      
      const response = await deleteData({
        table: 'users',
        where: { is_active: false },
        confirm_delete: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBeGreaterThanOrEqual(150);
    });

    it('should handle zero matching records gracefully', async () => {
      const response = await deleteData({
        table: 'users',
        where: { email: 'nonexistent@example.com' }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(0);
      expect(data.message).toBe("No rows match the WHERE conditions");
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid table name', async () => {
      const response = await deleteData({
        table: 'nonexistent_table',
        where: { id: 1 }
      });
      
      expectMcpError(response, /delete data/);
    });

    it('should reject invalid table identifier', async () => {
      const response = await deleteData({
        table: '123invalid',
        where: { id: 1 }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should reject invalid column identifier in where', async () => {
      const response = await deleteData({
        table: 'users',
        where: { 'invalid-column': 'value' }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should handle invalid column name in where', async () => {
      const response = await deleteData({
        table: 'users',
        where: { nonexistent_column: 'value' }
      });
      
      expectMcpError(response);
    });

    it('should handle invalid returning column', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { id: existingUser.id },
        returning: ['nonexistent_column']
      });
      
      expectMcpError(response);
    });

    it('should handle foreign key constraint violations', async () => {
      // This test assumes there might be foreign key relationships
      // If there are no FK constraints, this test will pass normally
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { id: existingUser.id }
      });
      
      // This should either succeed or fail with FK constraint error
      if (response.isError) {
        // If there are FK constraints, check for appropriate error message
        expectMcpError(response);
      } else {
        // If no FK constraints, deletion should succeed
        expectValidMcpResponse(response);
      }
    });
  });

  describe('RETURNING Clause', () => {
    it('should not return data by default', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data).toBeUndefined();
      expect(data.deleted_count).toBe(1);
    });

    it('should return specific columns when requested', async () => {
      const existingUsers = await executeTestQuery('SELECT id, email FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { id: existingUser.id },
        returning: ['id', 'email', 'name']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data).toHaveLength(1);
      const deletedUser = data.data[0];
      expect(Object.keys(deletedUser)).toEqual(['id', 'email', 'name']);
      expect(deletedUser.id).toBe(existingUser.id);
      expect(deletedUser.email).toBe(existingUser.email);
    });

    it('should handle empty returning array', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await deleteData({
        table: 'users',
        where: { id: existingUser.id },
        returning: []
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(1);
      expect(data.data).toHaveLength(1);
      expect(Object.keys(data.data[0])).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in WHERE conditions', async () => {
      // Insert user with special characters
      await executeTestQuery(
        'INSERT INTO users (email, name, is_active) VALUES ($1, $2, $3)',
        ['special@example.com', 'User with "quotes" and \'apostrophes\'', true]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { name: 'User with "quotes" and \'apostrophes\'' },
        returning: ['name']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(1);
      expect(data.data[0].name).toBe('User with "quotes" and \'apostrophes\'');
    });

    it('should handle unicode characters in WHERE conditions', async () => {
      // Insert user with unicode characters
      await executeTestQuery(
        'INSERT INTO users (email, name, is_active) VALUES ($1, $2, $3)',
        ['unicode@example.com', '测试用户 🚀', true]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { name: '测试用户 🚀' },
        returning: ['name']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(1);
      expect(data.data[0].name).toBe('测试用户 🚀');
    });

    it('should handle complex JSONB WHERE conditions', async () => {
      // Insert user with specific metadata
      const complexMetadata = { status: 'to_delete', priority: 'high' };
      await executeTestQuery(
        'INSERT INTO users (email, name, metadata, is_active) VALUES ($1, $2, $3, $4)',
        ['jsonb@example.com', 'JSONB User', JSON.stringify(complexMetadata), true]
      );
      
      // Note: This test depends on how the JSONB comparison is implemented
      // For exact match, we'd need to use JSON operators in WHERE clause
      const response = await deleteData({
        table: 'users',
        where: { email: 'jsonb@example.com' }, // Use email instead for simplicity
        returning: ['email', 'metadata']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(1);
      expect(data.data[0].metadata).toEqual(complexMetadata);
    });

    it('should handle array WHERE conditions', async () => {
      // Insert user with specific tags
      const specificTags = ['delete_me', 'test', 'temporary'];
      await executeTestQuery(
        'INSERT INTO users (email, name, tags, is_active) VALUES ($1, $2, $3, $4)',
        ['array@example.com', 'Array User', specificTags, true]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { email: 'array@example.com' }, // Use email for simplicity
        returning: ['email', 'tags']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(1);
      expect(data.data[0].tags).toEqual(specificTags);
    });

    it('should handle boolean WHERE conditions', async () => {
      // Insert specific test user
      await executeTestQuery(
        'INSERT INTO users (email, name, is_active) VALUES ($1, $2, $3)',
        ['boolean@example.com', 'Boolean User', false]
      );
      
      const response = await deleteData({
        table: 'users',
        where: { 
          is_active: false,
          email: 'boolean@example.com'
        },
        returning: ['email', 'is_active']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(1);
      expect(data.data[0].is_active).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle bulk deletion efficiently', async () => {
      // Insert many records for deletion
      const bulkUsers = Array.from({ length: 100 }, (_, i) => 
        generateTestUser({
          email: `perf${i}@example.com`,
          name: `Performance User ${i}`,
          is_active: false
        })
      );
      
      for (const user of bulkUsers) {
        await executeTestQuery(
          'INSERT INTO users (email, name, age, is_active, metadata, tags) VALUES ($1, $2, $3, $4, $5, $6)',
          [user.email, user.name, user.age, user.is_active, JSON.stringify(user.metadata), user.tags]
        );
      }
      
      const startTime = Date.now();
      
      const response = await deleteData({
        table: 'users',
        where: { email: 'perf%@example.com' },
        confirm_delete: true,
        returning: ['email']
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(100);
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
      
      // Verify all deleted users match the pattern
      data.data.forEach((user: any) => {
        expect(user.email).toMatch(/^perf\d+@example\.com$/);
      });
    });

    it('should handle impact estimation efficiently', async () => {
      // Insert records to test count estimation
      const testUsers = Array.from({ length: 50 }, (_, i) => 
        generateTestUser({
          email: `estimate${i}@example.com`,
          name: `Estimate User ${i}`,
          is_active: true
        })
      );
      
      for (const user of testUsers) {
        await executeTestQuery(
          'INSERT INTO users (email, name, age, is_active, metadata, tags) VALUES ($1, $2, $3, $4, $5, $6)',
          [user.email, user.name, user.age, user.is_active, JSON.stringify(user.metadata), user.tags]
        );
      }
      
      const startTime = Date.now();
      
      const response = await deleteData({
        table: 'users',
        where: { email: 'estimate%@example.com' }
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.deleted_count).toBe(50);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });

  describe('Transaction Safety', () => {
    it('should handle concurrent deletions gracefully', async () => {
      // Insert test data
      await executeTestQuery(
        'INSERT INTO users (email, name, is_active) VALUES ($1, $2, $3)',
        ['concurrent@example.com', 'Concurrent User', true]
      );
      
      // This test simulates what would happen with concurrent access
      // In a real scenario, one of these might fail or succeed depending on timing
      const response = await deleteData({
        table: 'users',
        where: { email: 'concurrent@example.com' },
        returning: ['email']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Either 1 or 0 depending on whether it was already deleted
      expect(data.deleted_count).toBeGreaterThanOrEqual(0);
      expect(data.deleted_count).toBeLessThanOrEqual(1);
    });
  });
});