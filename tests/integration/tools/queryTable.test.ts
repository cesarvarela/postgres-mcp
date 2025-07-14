import { describe, it, expect, beforeEach } from 'vitest';
import { queryTable, queryTableSchema } from '../../../tools/queryTable';
import { cleanTestData, getTestPool, insertTestData } from '../../setup/test-setup';
import { executeTestQuery, expectMcpError, expectValidMcpResponse, extractJsonFromMcpResponse, generateTestUser } from '../../setup/test-helpers';


describe('queryTable Tool', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  describe('Schema Validation', () => {
    it('should validate minimal valid parameters', () => {
      const params = { table: 'users' };
      const result = queryTableSchema.parse(params);
      
      expect(result.table).toBe('users');
      expect(result.columns).toBeUndefined();
      expect(result.where).toBeUndefined();
      expect(result.pagination).toBeUndefined();
      expect(result.sort).toBeUndefined();
    });

    it('should validate complete parameters', () => {
      const params = {
        table: 'users',
        columns: ['id', 'name', 'email'],
        where: { is_active: true, age: 30 },
        pagination: { limit: 10, offset: 0 },
        sort: { column: 'name', direction: 'DESC' as const }
      };
      
      const result = queryTableSchema.parse(params);
      expect(result).toEqual(params);
    });

    it('should reject empty table name', () => {
      expect(() => queryTableSchema.parse({ table: '' })).toThrow();
    });

    it('should reject empty column names', () => {
      expect(() => queryTableSchema.parse({ 
        table: 'users', 
        columns: ['id', '', 'name'] 
      })).toThrow();
    });

    it('should validate nested schemas', () => {
      const params = {
        table: 'users',
        pagination: { limit: 1001 }, // Should fail validation
      };
      
      expect(() => queryTableSchema.parse(params)).toThrow();
    });
  });

  describe('Basic Querying', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should query all rows from table', async () => {
      const response = await queryTable({ table: 'users' });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table).toBe('users');
      expect(data.count).toBeGreaterThan(0);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(data.count);
      
      // Verify all expected columns are present
      const firstUser = data.data[0];
      expect(firstUser).toHaveProperty('id');
      expect(firstUser).toHaveProperty('email');
      expect(firstUser).toHaveProperty('name');
      expect(firstUser).toHaveProperty('age');
      expect(firstUser).toHaveProperty('is_active');
    });

    it('should handle empty table', async () => {
      await cleanTestData();
      
      const response = await queryTable({ table: 'users' });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.table).toBe('users');
      expect(data.count).toBe(0);
      expect(data.data).toEqual([]);
    });

    it('should query specific columns', async () => {
      const response = await queryTable({ 
        table: 'users', 
        columns: ['id', 'email', 'name'] 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBeGreaterThan(0);
      
      data.data.forEach((user: any) => {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('name');
        expect(user).not.toHaveProperty('age');
        expect(user).not.toHaveProperty('is_active');
      });
    });

    it('should query single column', async () => {
      const response = await queryTable({ 
        table: 'users', 
        columns: ['email'] 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        expect(Object.keys(user)).toEqual(['email']);
      });
    });
  });

  describe('WHERE Conditions', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should filter by equality', async () => {
      const response = await queryTable({ 
        table: 'users', 
        where: { is_active: true } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBeGreaterThan(0);
      data.data.forEach((user: any) => {
        expect(user.is_active).toBe(true);
      });
    });

    it('should filter by multiple conditions', async () => {
      const response = await queryTable({ 
        table: 'users', 
        where: { is_active: true, age: 30 } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        expect(user.is_active).toBe(true);
        expect(user.age).toBe(30);
      });
    });

    it('should handle NULL values', async () => {
      // First, create a user with null age
      await executeTestQuery(
        'INSERT INTO users (email, name, age, is_active) VALUES ($1, $2, $3, $4)',
        ['nullage@example.com', 'Null Age User', null, true]
      );
      
      const response = await queryTable({ 
        table: 'users', 
        where: { age: null } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBeGreaterThan(0);
      data.data.forEach((user: any) => {
        expect(user.age).toBeNull();
      });
    });

    it('should handle IN operator with arrays', async () => {
      const response = await queryTable({ 
        table: 'users', 
        where: { age: [25, 30, 35] } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        expect([25, 30, 35]).toContain(user.age);
      });
    });

    it('should handle LIKE operator with wildcards', async () => {
      const response = await queryTable({ 
        table: 'users', 
        where: { email: '%@example.com' } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBeGreaterThan(0);
      data.data.forEach((user: any) => {
        expect(user.email).toMatch(/@example\.com$/);
      });
    });

    it('should handle complex LIKE patterns', async () => {
      const response = await queryTable({ 
        table: 'users', 
        where: { name: 'John%' } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        expect(user.name).toMatch(/^John/);
      });
    });

    it('should handle no matching results', async () => {
      const response = await queryTable({ 
        table: 'users', 
        where: { email: 'nonexistent@example.com' } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBe(0);
      expect(data.data).toEqual([]);
    });
  });

  describe('Sorting', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should sort by column ascending (default)', async () => {
      const response = await queryTable({ 
        table: 'users', 
        sort: { column: 'age' } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBeGreaterThan(1);
      
      // Verify ascending order
      for (let i = 1; i < data.data.length; i++) {
        expect(data.data[i].age).toBeGreaterThanOrEqual(data.data[i - 1].age);
      }
    });

    it('should sort by column descending', async () => {
      const response = await queryTable({ 
        table: 'users', 
        sort: { column: 'age', direction: 'DESC' } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBeGreaterThan(1);
      
      // Verify descending order
      for (let i = 1; i < data.data.length; i++) {
        expect(data.data[i].age).toBeLessThanOrEqual(data.data[i - 1].age);
      }
    });

    it('should sort by string column', async () => {
      const response = await queryTable({ 
        table: 'users', 
        sort: { column: 'name', direction: 'ASC' } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Verify ascending alphabetical order
      for (let i = 1; i < data.data.length; i++) {
        expect(data.data[i].name.localeCompare(data.data[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should combine sorting with WHERE conditions', async () => {
      const response = await queryTable({ 
        table: 'users',
        where: { is_active: true },
        sort: { column: 'age', direction: 'DESC' } 
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Verify all results match the filter
      data.data.forEach((user: any) => {
        expect(user.is_active).toBe(true);
      });
      
      // Verify sorting
      if (data.data.length > 1) {
        for (let i = 1; i < data.data.length; i++) {
          expect(data.data[i].age).toBeLessThanOrEqual(data.data[i - 1].age);
        }
      }
    });
  });

  describe('Pagination', () => {
    beforeEach(async () => {
      await cleanTestData();
      
      // Insert more test data for pagination testing
      const users = Array.from({ length: 25 }, (_, i) => generateTestUser({
        email: `user${i}@example.com`,
        name: `User ${i}`,
        age: 20 + i,
      }));
      
      for (const user of users) {
        await executeTestQuery(
          'INSERT INTO users (email, name, age, is_active, metadata, tags) VALUES ($1, $2, $3, $4, $5, $6)',
          [user.email, user.name, user.age, user.is_active, JSON.stringify(user.metadata), user.tags]
        );
      }
    });

    it('should paginate results with limit', async () => {
      const response = await queryTable({ 
        table: 'users',
        pagination: { limit: 10, offset: 0 }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBe(10);
      expect(data.data).toHaveLength(10);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBe(25);
      expect(data.pagination.limit).toBe(10);
      expect(data.pagination.offset).toBe(0);
      expect(data.pagination.hasMore).toBe(true);
    });

    it('should handle pagination offset', async () => {
      const response = await queryTable({ 
        table: 'users',
        pagination: { limit: 10, offset: 10 }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBe(10);
      expect(data.pagination.total).toBe(25);
      expect(data.pagination.offset).toBe(10);
      expect(data.pagination.hasMore).toBe(true);
    });

    it('should handle last page', async () => {
      const response = await queryTable({ 
        table: 'users',
        pagination: { limit: 10, offset: 20 }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBe(5); // Only 5 remaining
      expect(data.pagination.total).toBe(25);
      expect(data.pagination.hasMore).toBe(false);
    });

    it('should combine pagination with WHERE and ORDER BY', async () => {
      const response = await queryTable({ 
        table: 'users',
        where: { is_active: true },
        sort: { column: 'age', direction: 'ASC' },
        pagination: { limit: 5, offset: 0 }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBe(5);
      expect(data.pagination.total).toBeGreaterThan(0);
      
      // Verify filtering
      data.data.forEach((user: any) => {
        expect(user.is_active).toBe(true);
      });
      
      // Verify sorting within the page
      for (let i = 1; i < data.data.length; i++) {
        expect(data.data[i].age).toBeGreaterThanOrEqual(data.data[i - 1].age);
      }
    });

    it('should handle pagination beyond available data', async () => {
      const response = await queryTable({ 
        table: 'users',
        pagination: { limit: 10, offset: 100 }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBe(0);
      expect(data.data).toEqual([]);
      expect(data.pagination.total).toBe(25);
      expect(data.pagination.hasMore).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid table name', async () => {
      const response = await queryTable({ table: 'nonexistent_table' });
      
      expectMcpError(response, /query table/);
    });

    it('should handle invalid column name', async () => {
      await insertTestData();
      
      const response = await queryTable({ 
        table: 'users',
        columns: ['nonexistent_column']
      });
      
      expectMcpError(response);
    });

    it('should reject invalid table identifier', async () => {
      const response = await queryTable({ table: '123invalid' });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should reject invalid column identifier', async () => {
      const response = await queryTable({ 
        table: 'users',
        columns: ['user-invalid']
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should reject invalid sort column', async () => {
      await insertTestData();
      
      const response = await queryTable({ 
        table: 'users',
        sort: { column: 'invalid-column' }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });

    it('should handle where column with invalid identifier', async () => {
      const response = await queryTable({ 
        table: 'users',
        where: { 'invalid-column': 'value' }
      });
      
      expectMcpError(response, /invalid identifier/i);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should handle special characters in data', async () => {
      // Insert user with special characters
      await executeTestQuery(
        `INSERT INTO users (email, name, age, is_active, metadata) 
         VALUES ($1, $2, $3, $4, $5)`,
        [
          'special@example.com',
          'User with "quotes" and \'apostrophes\'',
          25,
          true,
          JSON.stringify({ special: "chars !@#$%^&*()" })
        ]
      );
      
      const response = await queryTable({ 
        table: 'users',
        where: { email: 'special@example.com' }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBe(1);
      expect(data.data[0].name).toBe('User with "quotes" and \'apostrophes\'');
    });

    it('should handle unicode characters', async () => {
      await executeTestQuery(
        'INSERT INTO users (email, name, age, is_active) VALUES ($1, $2, $3, $4)',
        ['unicode@example.com', '测试用户 🚀', 25, true]
      );
      
      const response = await queryTable({ 
        table: 'users',
        where: { name: '测试用户 🚀' }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBe(1);
      expect(data.data[0].name).toBe('测试用户 🚀');
    });

    it('should handle JSONB data types', async () => {
      const response = await queryTable({ 
        table: 'users',
        columns: ['id', 'email', 'metadata']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        if (user.metadata) {
          expect(typeof user.metadata).toBe('object');
        }
      });
    });

    it('should handle array data types', async () => {
      const response = await queryTable({ 
        table: 'users',
        columns: ['id', 'email', 'tags']
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      data.data.forEach((user: any) => {
        if (user.tags) {
          expect(Array.isArray(user.tags)).toBe(true);
        }
      });
    });

    it('should handle very large limit values', async () => {
      const response = await queryTable({ 
        table: 'users',
        pagination: { limit: 1000, offset: 0 }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.count).toBeLessThanOrEqual(1000);
      expect(data.pagination.limit).toBe(1000);
    });
  });

  describe('Complex Queries', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should handle all features combined', async () => {
      const response = await queryTable({
        table: 'users',
        columns: ['id', 'email', 'name', 'age'],
        where: { is_active: true },
        sort: { column: 'age', direction: 'DESC' },
        pagination: { limit: 2, offset: 0 }
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Verify response structure
      expect(data.table).toBe('users');
      expect(data.count).toBe(2);
      expect(data.data).toHaveLength(2);
      expect(data.pagination).toBeDefined();
      
      // Verify column selection
      data.data.forEach((user: any) => {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('age');
        expect(user).not.toHaveProperty('is_active');
        expect(user).not.toHaveProperty('metadata');
      });
      
      // Verify sorting
      if (data.data.length > 1) {
        expect(data.data[0].age).toBeGreaterThanOrEqual(data.data[1].age);
      }
    });
  });
});