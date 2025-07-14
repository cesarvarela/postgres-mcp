import { expect } from 'vitest';
import { getTestPool, insertTestData, cleanTestData } from './test-setup';

// Re-export functions from test-setup for convenience
export { insertTestData, cleanTestData };

// Type definitions for test helpers
export interface McpResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

export interface TestUser {
  id: number;
  email: string;
  name: string;
  age: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  metadata: any;
  tags: string[];
}

export interface TestProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  in_stock: boolean;
  category: string;
  tags: string[];
  attributes: any;
  created_at: string;
}

// Helper to validate MCP response structure
export function expectValidMcpResponse(response: any): asserts response is McpResponse {
  expect(response).toBeDefined();
  expect(response).toHaveProperty('content');
  expect(Array.isArray(response.content)).toBe(true);
  expect(response.content.length).toBeGreaterThan(0);
  
  response.content.forEach((item: any) => {
    expect(item).toHaveProperty('type', 'text');
    expect(item).toHaveProperty('text');
    expect(typeof item.text).toBe('string');
  });
}

// Helper to extract JSON data from MCP response
export function extractJsonFromMcpResponse(response: McpResponse): any {
  expectValidMcpResponse(response);
  
  const text = response.content[0].text;
  
  // Try to find JSON in the response
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*\}/);
  
  if (jsonMatch) {
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      throw new Error(`Failed to parse JSON from MCP response: ${jsonStr}`);
    }
  }
  
  // If no JSON block found, try parsing the entire text
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`No valid JSON found in MCP response: ${text}`);
  }
}

// Helper to check if MCP response indicates an error
export function expectMcpError(response: any, expectedErrorPattern?: string | RegExp): void {
  expectValidMcpResponse(response);
  const text = response.content[0].text.toLowerCase();
  
  expect(
    text.includes('error') || 
    text.includes('failed') || 
    text.includes('invalid') ||
    text.includes('not found')
  ).toBe(true);
  
  if (expectedErrorPattern) {
    if (typeof expectedErrorPattern === 'string') {
      expect(text).toContain(expectedErrorPattern.toLowerCase());
    } else {
      expect(text).toMatch(expectedErrorPattern);
    }
  }
}

// Helper to execute raw SQL for testing
export async function executeTestQuery(query: string, params: any[] = []): Promise<any[]> {
  const pool = getTestPool();
  const client = await pool.connect();
  
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// Helper to get table row count
export async function getTableRowCount(tableName: string): Promise<number> {
  const result = await executeTestQuery(`SELECT COUNT(*) as count FROM ${tableName}`);
  return parseInt(result[0].count);
}

// Helper to check if table exists
export async function tableExists(tableName: string): Promise<boolean> {
  const result = await executeTestQuery(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = $1
    )
  `, [tableName]);
  
  return result[0].exists;
}

// Helper to get table columns
export async function getTableColumns(tableName: string): Promise<any[]> {
  return executeTestQuery(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);
}

// Helper to create a test table for specific tests
export async function createTestTable(
  tableName: string, 
  schema: string
): Promise<void> {
  await executeTestQuery(`CREATE TABLE ${tableName} (${schema})`);
}

// Helper to drop a test table
export async function dropTestTable(tableName: string): Promise<void> {
  await executeTestQuery(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
}

// Helper to validate database constraints
export async function expectConstraintViolation(
  operation: () => Promise<any>,
  constraintType: 'unique' | 'foreign_key' | 'check' | 'not_null' = 'unique'
): Promise<void> {
  await expect(operation()).rejects.toThrow();
}

// Helper to measure query performance
export async function measureQueryTime(
  operation: () => Promise<any>
): Promise<{ result: any; timeMs: number }> {
  const startTime = Date.now();
  const result = await operation();
  const timeMs = Date.now() - startTime;
  
  return { result, timeMs };
}

// Helper to generate test data
export function generateTestUser(overrides: Partial<TestUser> = {}): Partial<TestUser> {
  const timestamp = new Date().toISOString();
  return {
    email: `test${Date.now()}@example.com`,
    name: 'Test User',
    age: 25,
    is_active: true,
    metadata: { role: 'test' },
    tags: ['test'],
    ...overrides
  };
}

export function generateTestProduct(overrides: Partial<TestProduct> = {}): Partial<TestProduct> {
  return {
    name: `Test Product ${Date.now()}`,
    description: 'A test product',
    price: '99.99',
    in_stock: true,
    category: 'Test',
    tags: ['test'],
    attributes: { test: true },
    ...overrides
  };
}

// Helper to wait for async operations in tests
export function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to assert array contains subset
export function expectArrayContainsSubset<T>(
  actual: T[], 
  expected: Partial<T>[]
): void {
  expected.forEach(expectedItem => {
    const found = actual.some(actualItem => {
      return Object.keys(expectedItem).every(key => {
        return actualItem[key as keyof T] === expectedItem[key as keyof T];
      });
    });
    
    expect(found).toBe(true);
  });
}

// Helper to validate SQL injection prevention
export function getCommonSqlInjectionPayloads(): string[] {
  return [
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
}