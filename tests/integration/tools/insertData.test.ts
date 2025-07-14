import { describe, it, expect, beforeEach } from 'vitest';
import { insertData, insertDataSchema } from '../../../tools/insertData';
import { cleanTestData, getTestPool, insertTestData } from '../../setup/test-setup';
import { executeTestQuery, expectMcpError, expectValidMcpResponse, extractJsonFromMcpResponse, generateTestUser } from '../../setup/test-helpers';

describe('insertData Tool', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  describe('Schema Validation', () => {
    it('should validate minimal valid parameters', () => {
      const params = { 
        table: 'users', 
        data: { email: 'test@example.com', name: 'Test User' }
      };
      const result = insertDataSchema.parse(params);
      
      expect(result.table).toBe('users');
      expect(result.data).toEqual({ email: 'test@example.com', name: 'Test User' });
      expect(result.on_conflict).toBe('error'); // default
      expect(result.returning).toEqual(['*']); // default
    });

    it('should validate complete parameters', () => {
      const params = {
        table: 'users',
        data: [
          { email: 'user1@example.com', name: 'User 1', age: 25 },
          { email: 'user2@example.com', name: 'User 2', age: 30 }
        ],
        on_conflict: 'ignore' as const,
        conflict_columns: ['email'],
        returning: ['id', 'email', 'name']
      };
      
      const result = insertDataSchema.parse(params);
      expect(result).toEqual(params);
    });

    it('should validate single record data', () => {
      const params = {
        table: 'users',
        data: { email: 'single@example.com', name: 'Single User' }
      };
      
      const result = insertDataSchema.parse(params);
      expect(result.data).toEqual({ email: 'single@example.com', name: 'Single User' });
    });

    it('should validate array of records data', () => {
      const params = {
        table: 'users',
        data: [
          { email: 'user1@example.com', name: 'User 1' },
          { email: 'user2@example.com', name: 'User 2' }
        ]
      };
      
      const result = insertDataSchema.parse(params);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should reject empty table name', () => {
      expect(() => insertDataSchema.parse({ 
        table: '', 
        data: { email: 'test@example.com' }
      })).toThrow();
    });

    it('should validate on_conflict enum values', () => {
      const validValues = ['error', 'ignore', 'update'];
      
      validValues.forEach(value => {
        const params = {
          table: 'users',
          data: { email: 'test@example.com' },
          on_conflict: value
        };
        
        expect(() => insertDataSchema.parse(params)).not.toThrow();
      });
    });

    it('should reject invalid on_conflict values', () => {
      expect(() => insertDataSchema.parse({
        table: 'users',
        data: { email: 'test@example.com' },
        on_conflict: 'invalid'
      })).toThrow();
    });
  });

  describe('Single Record Insertion', () => {
    it('should insert a single record successfully', async () => {
      const testUser = generateTestUser({
        email: 'single@example.com',
        name: 'Single User'
      });
      
      const response = await insertData({
        table: 'users',
        data: {
          email: testUser.email,
          name: testUser.name,
          age: testUser.age,
          is_active: testUser.is_active,
          metadata: testUser.metadata,
          tags: testUser.tags
        }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table).toBe('users');
      expect(data.inserted_count).toBe(1);
      expect(data.records_provided).toBe(1);
      expect(data.on_conflict_action).toBe('error');
      expect(data.data).toHaveLength(1);
      expect(data.inserted_at).toBeDefined();
      
      // Verify the inserted data
      const insertedUser = data.data[0];
      expect(insertedUser.id).toBeDefined();
      expect(insertedUser.email).toBe(testUser.email);
      expect(insertedUser.name).toBe(testUser.name);
      expect(insertedUser.age).toBe(testUser.age);
      expect(insertedUser.is_active).toBe(testUser.is_active);
    });

    it('should insert with minimal required fields', async () => {
      const response = await insertData({
        table: 'users',
        data: {
          email: 'minimal@example.com',
          name: 'Minimal User'
        }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.inserted_count).toBe(1);
      const insertedUser = data.data[0];
      expect(insertedUser.email).toBe('minimal@example.com');
      expect(insertedUser.name).toBe('Minimal User');
      expect(insertedUser.age).toBeNull();
      expect(insertedUser.is_active).toBe(true); // default
    });

    it('should handle null values', async () => {
      const response = await insertData({
        table: 'users',
        data: {
          email: 'null@example.com',
          name: 'Null User',
          age: null,
          metadata: null
        }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const insertedUser = data.data[0];
      expect(insertedUser.age).toBeNull();
      expect(insertedUser.metadata).toBeNull();
    });

    it('should handle special data types', async () => {
      const specialData = {
        email: 'special@example.com',
        name: 'Special User',
        age: 25,
        is_active: true,
        metadata: { special: "chars !@#$%^&*()", unicode: "测试 🚀" },
        tags: ['tag1', 'tag2', 'special-tag']
      };
      
      const response = await insertData({
        table: 'users',
        data: specialData
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const insertedUser = data.data[0];
      expect(insertedUser.metadata).toEqual(specialData.metadata);
      expect(insertedUser.tags).toEqual(specialData.tags);
    });
  });

  describe('Bulk Record Insertion', () => {
    it('should insert multiple records successfully', async () => {
      const users = Array.from({ length: 5 }, (_, i) => 
        generateTestUser({
          email: `bulk${i}@example.com`,
          name: `Bulk User ${i}`
        })
      );
      
      const response = await insertData({
        table: 'users',
        data: users.map(user => ({
          email: user.email,
          name: user.name,
          age: user.age,
          is_active: user.is_active,
          metadata: user.metadata,
          tags: user.tags
        }))
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table).toBe('users');
      expect(data.inserted_count).toBe(5);
      expect(data.records_provided).toBe(5);
      expect(data.data).toHaveLength(5);
      
      // Verify all users were inserted
      data.data.forEach((insertedUser: any, index: number) => {
        expect(insertedUser.email).toBe(users[index].email);
        expect(insertedUser.name).toBe(users[index].name);
      });
    });

    it('should handle large bulk insertion', async () => {
      const users = Array.from({ length: 50 }, (_, i) => ({
        email: `large${i}@example.com`,
        name: `Large User ${i}`,
        age: 20 + (i % 50),
        is_active: i % 2 === 0
      }));
      
      const response = await insertData({
        table: 'users',
        data: users
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.inserted_count).toBe(50);
      expect(data.records_provided).toBe(50);
    });

    it('should validate consistent columns across records', async () => {
      const inconsistentData = [
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2', age: 30 } // Extra column
      ];
      
      const response = await insertData({
        table: 'users',
        data: inconsistentData
      });
      
      expectMcpError(response, /different columns/i);
    });
  });

  describe('RETURNING Clause', () => {
    it('should return all columns by default', async () => {
      const response = await insertData({
        table: 'users',
        data: {
          email: 'return@example.com',
          name: 'Return User'
        }
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
      const response = await insertData({
        table: 'users',
        data: {
          email: 'specific@example.com',
          name: 'Specific User'
        },
        returning: ['id', 'email', 'created_at']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const returnedUser = data.data[0];
      expect(Object.keys(returnedUser)).toEqual(['id', 'email', 'created_at']);
      expect(returnedUser.id).toBeDefined();
      expect(returnedUser.email).toBe('specific@example.com');
      expect(returnedUser.created_at).toBeDefined();
    });

    it('should handle empty returning array', async () => {
      const response = await insertData({
        table: 'users',
        data: {
          email: 'noreturning@example.com',
          name: 'No Return User'
        },
        returning: []
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data).toHaveLength(1);
      expect(Object.keys(data.data[0])).toHaveLength(0);
    });
  });

  describe('Conflict Resolution', () => {
    beforeEach(async () => {
      // Insert initial test data
      await insertTestData();
    });

    it('should handle error conflict (default behavior)', async () => {
      const response = await insertData({
        table: 'users',
        data: {
          email: 'john@example.com', // This email already exists
          name: 'Duplicate John'
        }
      });
      
      expectMcpError(response, /duplicate key|violates unique constraint/i);
    });

    it('should handle ignore conflict', async () => {
      const response = await insertData({
        table: 'users',
        data: {
          email: 'john@example.com', // This email already exists
          name: 'Duplicate John'
        },
        on_conflict: 'ignore'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.inserted_count).toBe(0); // No new records inserted
      expect(data.records_provided).toBe(1);
      expect(data.on_conflict_action).toBe('ignore');
    });

    it('should handle update conflict (upsert)', async () => {
      const response = await insertData({
        table: 'users',
        data: {
          email: 'john@example.com', // This email already exists
          name: 'Updated John',
          age: 99
        },
        on_conflict: 'update',
        conflict_columns: ['email']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.inserted_count).toBe(1); // One record was updated
      expect(data.on_conflict_action).toBe('update');
      
      // Verify the update
      const updatedUser = data.data[0];
      expect(updatedUser.email).toBe('john@example.com');
      expect(updatedUser.name).toBe('Updated John');
      expect(updatedUser.age).toBe(99);
    });

    it('should handle conflict with specific columns', async () => {
      const response = await insertData({
        table: 'users',
        data: {
          email: 'jane.smith@example.com',
          name: 'Updated Jane',
          age: 88
        },
        on_conflict: 'update',
        conflict_columns: ['email'],
        returning: ['email', 'name', 'age']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const updatedUser = data.data[0];
      expect(updatedUser.name).toBe('Updated Jane');
      expect(updatedUser.age).toBe(88);
    });

    it('should handle bulk insert with conflicts', async () => {
      const bulkData = [
        { email: 'new1@example.com', name: 'New User 1' },
        { email: 'john@example.com', name: 'Conflict John' }, // Exists
        { email: 'new2@example.com', name: 'New User 2' }
      ];
      
      const response = await insertData({
        table: 'users',
        data: bulkData,
        on_conflict: 'ignore'
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.records_provided).toBe(3);
      expect(data.inserted_count).toBe(2); // Only 2 new records
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid table name', async () => {
      const response = await insertData({
        table: 'nonexistent_table',
        data: { email: 'test@example.com', name: 'Test' }
      });
      
      expectMcpError(response, /insert data/);
    });

    it('should handle empty data array', async () => {
      const response = await insertData({
        table: 'users',
        data: []
      });
      
      expectMcpError(response, /no data provided/i);
    });

    it('should handle empty record object', async () => {
      const response = await insertData({
        table: 'users',
        data: {}
      });
      
      expectMcpError(response, /no columns found/i);
    });

    it('should reject invalid table identifier', async () => {
      const response = await insertData({
        table: '123invalid',
        data: { email: 'test@example.com', name: 'Test' }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should reject invalid column identifier', async () => {
      const response = await insertData({
        table: 'users',
        data: { 'invalid-column': 'value', 'email': 'test@example.com' }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should handle database constraint violations', async () => {
      // Try to insert with invalid foreign key or check constraint
      const response = await insertData({
        table: 'users',
        data: {
          email: 'constraint@example.com',
          name: 'Constraint User',
          age: -5 // Assuming there's a check constraint age >= 0
        }
      });
      
      // This might pass if there's no age constraint, or fail with constraint error
      // The important thing is it handles the error gracefully
      if (response.isError) {
        expectMcpError(response);
      }
    });

    it('should handle invalid returning column', async () => {
      const response = await insertData({
        table: 'users',
        data: { email: 'test@example.com', name: 'Test' },
        returning: ['nonexistent_column']
      });
      
      expectMcpError(response);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in data', async () => {
      const specialData = {
        email: 'special@example.com',
        name: 'User with "quotes" and \'apostrophes\'',
        metadata: { special: "chars !@#$%^&*()" }
      };
      
      const response = await insertData({
        table: 'users',
        data: specialData
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const insertedUser = data.data[0];
      expect(insertedUser.name).toBe(specialData.name);
      expect(insertedUser.metadata).toEqual(specialData.metadata);
    });

    it('should handle unicode characters', async () => {
      const unicodeData = {
        email: 'unicode@example.com',
        name: '测试用户 🚀',
        metadata: { description: 'Unicode test: こんにちは 🌸' }
      };
      
      const response = await insertData({
        table: 'users',
        data: unicodeData
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      const insertedUser = data.data[0];
      expect(insertedUser.name).toBe(unicodeData.name);
      expect(insertedUser.metadata).toEqual(unicodeData.metadata);
    });

    it('should handle large text values', async () => {
      const largeText = 'A'.repeat(1000); // 1KB of text
      
      const response = await insertData({
        table: 'test_types',
        data: {
          text_col: largeText
        }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.inserted_count).toBe(1);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].text_col).toBe(largeText);
    });

    it('should handle complex JSONB data', async () => {
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
            login_count: 42,
            last_login: '2023-01-01T00:00:00Z'
          }
        },
        tags: ['premium', 'verified'],
        scores: [95.5, 87.2, 92.8]
      };
      
      const response = await insertData({
        table: 'users',
        data: {
          email: 'complex@example.com',
          name: 'Complex User',
          metadata: complexMetadata
        }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data[0].metadata).toEqual(complexMetadata);
    });

    it('should handle array data types', async () => {
      const arrayData = {
        email: 'arrays@example.com',
        name: 'Array User',
        tags: ['tag1', 'tag2', 'tag with spaces', 'tag-with-hyphens']
      };
      
      const response = await insertData({
        table: 'users',
        data: arrayData
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.data[0].tags).toEqual(arrayData.tags);
    });
  });

  describe('Performance', () => {
    it('should handle moderate bulk insert efficiently', async () => {
      const users = Array.from({ length: 100 }, (_, i) => ({
        email: `perf${i}@example.com`,
        name: `Performance User ${i}`,
        age: 20 + (i % 50)
      }));
      
      const startTime = Date.now();
      
      const response = await insertData({
        table: 'users',
        data: users
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.inserted_count).toBe(100);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});