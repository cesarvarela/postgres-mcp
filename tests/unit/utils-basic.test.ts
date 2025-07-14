import { describe, it, expect } from 'vitest';
import {
  createMcpSuccessResponse,
  createMcpErrorResponse,
  paginationSchema,
  sortSchema,
  validateIdentifier,
  sanitizeIdentifier,
} from '../../tools/utils';

describe('Database Utils - Basic (No DB Required)', () => {
  describe('MCP Response Functions', () => {
    describe('createMcpSuccessResponse', () => {
      it('should create valid MCP success response with simple data', async () => {
        const data = { message: 'success', count: 5 };
        const response = await createMcpSuccessResponse(data);
        
        expect(response).toBeDefined();
        expect(response).toHaveProperty('content');
        expect(Array.isArray(response.content)).toBe(true);
        expect(response.content.length).toBeGreaterThan(0);
        
        const firstContent = response.content[0];
        expect(firstContent).toHaveProperty('type', 'text');
        expect(firstContent).toHaveProperty('text');
        
        const parsedData = JSON.parse(firstContent.text);
        expect(parsedData).toEqual(data);
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
        
        expect(response).toBeDefined();
        expect(response.content[0].type).toBe('text');
        
        const parsedData = JSON.parse(response.content[0].text);
        expect(parsedData.error).toBe('Failed to test operation');
        expect(parsedData.message).toBe('Test error message');
        expect(parsedData.timestamp).toBeDefined();
        expect(new Date(parsedData.timestamp)).toBeInstanceOf(Date);
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
        
        // Valid bounds
        expect(paginationSchema.parse({ limit: 1 })).toEqual({ limit: 1, offset: 0 });
        expect(paginationSchema.parse({ limit: 1000 })).toEqual({ limit: 1000, offset: 0 });
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
      });
    });
  });
});