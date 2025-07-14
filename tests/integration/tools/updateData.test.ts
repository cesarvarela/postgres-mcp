import { describe, it, expect, beforeEach } from 'vitest';
import { updateData, updateDataSchema } from '../../../tools/updateData';
import { cleanTestData, getTestPool, insertTestData } from '../../setup/test-setup';
import { executeTestQuery, expectMcpError, expectValidMcpResponse, extractJsonFromMcpResponse, generateTestUser } from '../../setup/test-helpers';

describe('updateData Tool', () => {
  beforeEach(async () => {
    await cleanTestData();
    await insertTestData(); // Insert test data for updating
  });

  describe('Schema Validation', () => {
    it('should validate minimal valid parameters', () => {
      const params = { 
        table: 'users', 
        data: { name: 'Updated Name' },
        where: { id: 1 }
      };
      const result = updateDataSchema.parse(params);
      
      expect(result.table).toBe('users');
      expect(result.data).toEqual({ name: 'Updated Name' });
      expect(result.where).toEqual({ id: 1 });
      expect(result.returning).toEqual(['*']); // default
    });

    it('should validate complete parameters', () => {
      const params = {
        table: 'users',
        data: { name: 'New Name', age: 30, is_active: false },
        where: { email: 'test@example.com', is_active: true },
        returning: ['id', 'name', 'age', 'updated_at']
      };
      
      const result = updateDataSchema.parse(params);
      expect(result).toEqual(params);
    });

    it('should reject empty table name', () => {
      expect(() => updateDataSchema.parse({ 
        table: '', 
        data: { name: 'Test' },
        where: { id: 1 }
      })).toThrow();
    });

    it('should accept empty data object in schema (but will fail in business logic)', () => {
      const params = {
        table: 'users',
        data: {},
        where: { id: 1 }
      };
      
      // Schema validation should pass
      expect(() => updateDataSchema.parse(params)).not.toThrow();
    });

    it('should accept empty where object in schema (but will fail in business logic)', () => {
      const params = {
        table: 'users',
        data: { name: 'Test' },
        where: {}
      };
      
      // Schema validation should pass
      expect(() => updateDataSchema.parse(params)).not.toThrow();
    });
  });

  describe('Single Record Updates', () => {
    it('should update a single record successfully', async () => {
      // First, get an existing user
      const existingUsers = await executeTestQuery('SELECT id, email, name FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await updateData({
        table: 'users',
        data: {
          name: 'Updated Name',
          age: 99
        },
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table).toBe('users');
      expect(data.updated_count).toBe(1);
      expect(data.data).toHaveLength(1);
      expect(data.updated_at).toBeDefined();
      
      // Verify the updated data
      const updatedUser = data.data[0];
      expect(updatedUser.id).toBe(existingUser.id);
      expect(updatedUser.name).toBe('Updated Name');
      expect(updatedUser.age).toBe(99);
      expect(updatedUser.email).toBe(existingUser.email); // Unchanged
    });

    it('should update with null values', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users WHERE age IS NOT NULL LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await updateData({
        table: 'users',
        data: {
          age: null,
          metadata: null
        },
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const updatedUser = data.data[0];
      expect(updatedUser.age).toBeNull();
      expect(updatedUser.metadata).toBeNull();
    });

    it('should update complex data types', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const newMetadata = {
        updated: true,
        timestamp: new Date().toISOString(),
        nested: { key: 'value', number: 42 }
      };
      
      const newTags = ['updated', 'test', 'integration'];
      
      const response = await updateData({
        table: 'users',
        data: {
          metadata: newMetadata,
          tags: newTags
        },
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const updatedUser = data.data[0];
      expect(updatedUser.metadata).toEqual(newMetadata);
      expect(updatedUser.tags).toEqual(newTags);
    });

    it('should handle no matching records', async () => {
      const response = await updateData({
        table: 'users',
        data: { name: 'No Match' },
        where: { id: 99999 } // Non-existent ID
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.updated_count).toBe(0);
      expect(data.data).toEqual([]);
    });
  });

  describe('Multiple Record Updates', () => {
    it('should update multiple records with same where condition', async () => {
      const response = await updateData({
        table: 'users',
        data: {
          is_active: false,
          metadata: { bulk_updated: true }
        },
        where: { is_active: true }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.updated_count).toBeGreaterThan(0);
      
      // Verify all returned records have the updated values
      data.data.forEach((user: any) => {
        expect(user.is_active).toBe(false);
        expect(user.metadata.bulk_updated).toBe(true);
      });
    });

    it('should update records matching complex where conditions', async () => {
      const response = await updateData({
        table: 'users',
        data: { 
          name: 'Batch Updated',
          age: 50 
        },
        where: { 
          is_active: true,
          age: 30 
        }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Verify all updated records match the conditions
      data.data.forEach((user: any) => {
        expect(user.name).toBe('Batch Updated');
        expect(user.age).toBe(50);
      });
    });
  });

  describe('WHERE Clause Conditions', () => {
    it('should handle equality conditions', async () => {
      const existingUsers = await executeTestQuery('SELECT email FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await updateData({
        table: 'users',
        data: { name: 'Equality Update' },
        where: { email: existingUser.email }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.updated_count).toBe(1);
      expect(data.data[0].name).toBe('Equality Update');
    });

    it('should handle NULL conditions', async () => {
      // First create a user with null age
      await executeTestQuery(
        'INSERT INTO users (email, name, age, is_active) VALUES ($1, $2, $3, $4)',
        ['nullage@example.com', 'Null Age User', null, true]
      );
      
      const response = await updateData({
        table: 'users',
        data: { name: 'Updated Null Age' },
        where: { age: null }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.updated_count).toBeGreaterThan(0);
      data.data.forEach((user: any) => {
        expect(user.age).toBeNull();
        expect(user.name).toBe('Updated Null Age');
      });
    });

    it('should handle IN operator with arrays', async () => {
      const response = await updateData({
        table: 'users',
        data: { name: 'Array Match Update' },
        where: { age: [25, 30, 35] }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        expect([25, 30, 35]).toContain(user.age);
        expect(user.name).toBe('Array Match Update');
      });
    });

    it('should handle LIKE operator with wildcards', async () => {
      const response = await updateData({
        table: 'users',
        data: { metadata: { like_updated: true } },
        where: { email: '%@example.com' }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.updated_count).toBeGreaterThan(0);
      data.data.forEach((user: any) => {
        expect(user.email).toMatch(/@example\.com$/);
        expect(user.metadata.like_updated).toBe(true);
      });
    });

    it('should handle multiple conditions (AND logic)', async () => {
      const response = await updateData({
        table: 'users',
        data: { name: 'Multi Condition Update' },
        where: { 
          is_active: true,
          age: 30 
        }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        expect(user.is_active).toBe(true);
        expect(user.age).toBe(30);
        expect(user.name).toBe('Multi Condition Update');
      });
    });
  });

  describe('RETURNING Clause', () => {
    it('should return all columns by default', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await updateData({
        table: 'users',
        data: { name: 'Return All Test' },
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const returnedUser = data.data[0];
      expect(returnedUser).toHaveProperty('id');
      expect(returnedUser).toHaveProperty('email');
      expect(returnedUser).toHaveProperty('name');
      expect(returnedUser).toHaveProperty('age');
      expect(returnedUser).toHaveProperty('is_active');
      expect(returnedUser).toHaveProperty('metadata');
      expect(returnedUser).toHaveProperty('tags');
      expect(returnedUser).toHaveProperty('created_at');
    });

    it('should return specific columns when requested', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await updateData({
        table: 'users',
        data: { name: 'Specific Return Test' },
        where: { id: existingUser.id },
        returning: ['id', 'name', 'email']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const returnedUser = data.data[0];
      expect(Object.keys(returnedUser)).toEqual(['id', 'name', 'email']);
      expect(returnedUser.name).toBe('Specific Return Test');
    });

    it('should handle empty returning array', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await updateData({
        table: 'users',
        data: { name: 'No Return Test' },
        where: { id: existingUser.id },
        returning: []
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.updated_count).toBe(1);
      expect(data.data).toHaveLength(1);
      expect(Object.keys(data.data[0])).toHaveLength(0);
    });
  });

  describe('Safety Features', () => {
    it('should require WHERE clause for safety', async () => {
      const response = await updateData({
        table: 'users',
        data: { name: 'Dangerous Update' },
        where: {} // Empty where clause
      });
      
      expectMcpError(response, /where clause is required/i);
    });

    it('should reject updates without data', async () => {
      const response = await updateData({
        table: 'users',
        data: {}, // Empty data
        where: { id: 1 }
      });
      
      expectMcpError(response, /no data provided/i);
    });

    it('should prevent accidental mass updates', async () => {
      // This is handled by requiring WHERE clause
      const response = await updateData({
        table: 'users',
        data: { name: 'Mass Update' },
        where: {} // This should be rejected
      });
      
      expectMcpError(response, /where clause is required/i);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid table name', async () => {
      const response = await updateData({
        table: 'nonexistent_table',
        data: { name: 'Test' },
        where: { id: 1 }
      });
      
      expectMcpError(response, /update data/);
    });

    it('should reject invalid table identifier', async () => {
      const response = await updateData({
        table: '123invalid',
        data: { name: 'Test' },
        where: { id: 1 }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should reject invalid column identifier in data', async () => {
      const response = await updateData({
        table: 'users',
        data: { 'invalid-column': 'value' },
        where: { id: 1 }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should reject invalid column identifier in where', async () => {
      const response = await updateData({
        table: 'users',
        data: { name: 'Test' },
        where: { 'invalid-column': 'value' }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should handle invalid column name in data', async () => {
      const response = await updateData({
        table: 'users',
        data: { nonexistent_column: 'value' },
        where: { id: 1 }
      });
      
      expectMcpError(response);
    });

    it('should handle invalid column name in where', async () => {
      const response = await updateData({
        table: 'users',
        data: { name: 'Test' },
        where: { nonexistent_column: 'value' }
      });
      
      expectMcpError(response);
    });

    it('should handle invalid returning column', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await updateData({
        table: 'users',
        data: { name: 'Test' },
        where: { id: existingUser.id },
        returning: ['nonexistent_column']
      });
      
      expectMcpError(response);
    });

    it('should handle constraint violations', async () => {
      const existingUsers = await executeTestQuery('SELECT id, email FROM users LIMIT 2');
      const user1 = existingUsers[0];
      const user2 = existingUsers[1];
      
      // Try to update user1's email to user2's email (should violate unique constraint)
      const response = await updateData({
        table: 'users',
        data: { email: user2.email },
        where: { id: user1.id }
      });
      
      expectMcpError(response, /duplicate key|unique constraint/i);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in data', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const specialData = {
        name: 'User with "quotes" and \'apostrophes\'',
        metadata: { special: "chars !@#$%^&*()" }
      };
      
      const response = await updateData({
        table: 'users',
        data: specialData,
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const updatedUser = data.data[0];
      expect(updatedUser.name).toBe(specialData.name);
      expect(updatedUser.metadata).toEqual(specialData.metadata);
    });

    it('should handle unicode characters', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const unicodeData = {
        name: '测试用户 🚀',
        metadata: { description: 'Unicode test: こんにちは 🌸' }
      };
      
      const response = await updateData({
        table: 'users',
        data: unicodeData,
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const updatedUser = data.data[0];
      expect(updatedUser.name).toBe(unicodeData.name);
      expect(updatedUser.metadata).toEqual(unicodeData.metadata);
    });

    it('should handle large text values', async () => {
      // Create a test record first
      await executeTestQuery('INSERT INTO test_types (text_col) VALUES ($1)', ['initial text']);
      const existingRecords = await executeTestQuery('SELECT id FROM test_types LIMIT 1');
      const existingRecord = existingRecords[0];
      
      const largeText = 'A'.repeat(1000); // 1KB of text
      
      const response = await updateData({
        table: 'test_types',
        data: { text_col: largeText },
        where: { id: existingRecord.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data[0].text_col).toBe(largeText);
    });

    it('should handle complex JSONB updates', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const complexMetadata = {
        profile: {
          preferences: {
            theme: 'dark',
            language: 'en',
            notifications: {
              email: true,
              push: false,
              sms: null
            }
          },
          stats: {
            update_count: 1,
            last_updated: new Date().toISOString()
          }
        },
        tags: ['updated', 'complex'],
        scores: [95.5, 87.2, 92.8]
      };
      
      const response = await updateData({
        table: 'users',
        data: { metadata: complexMetadata },
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data[0].metadata).toEqual(complexMetadata);
    });

    it('should handle array updates', async () => {
      const existingUsers = await executeTestQuery('SELECT id FROM users LIMIT 1');
      const existingUser = existingUsers[0];
      
      const newTags = ['updated', 'test', 'array', 'tag with spaces', 'tag-with-hyphens'];
      
      const response = await updateData({
        table: 'users',
        data: { tags: newTags },
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data[0].tags).toEqual(newTags);
    });

    it('should handle boolean updates', async () => {
      const existingUsers = await executeTestQuery('SELECT id, is_active FROM users WHERE is_active = true LIMIT 1');
      const existingUser = existingUsers[0];
      
      const response = await updateData({
        table: 'users',
        data: { is_active: false },
        where: { id: existingUser.id }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data[0].is_active).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should handle bulk updates efficiently', async () => {
      // Insert many test records first
      const bulkUsers = Array.from({ length: 50 }, (_, i) => 
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
      
      const startTime = Date.now();
      
      const response = await updateData({
        table: 'users',
        data: { 
          name: 'Bulk Updated',
          metadata: { bulk_update: true }
        },
        where: { email: '%bulk%@example.com' }
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.updated_count).toBe(50);
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
      
      // Verify all were updated
      data.data.forEach((user: any) => {
        expect(user.name).toBe('Bulk Updated');
        expect(user.metadata.bulk_update).toBe(true);
      });
    });
  });
});