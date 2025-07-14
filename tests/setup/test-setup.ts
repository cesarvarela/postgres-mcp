import { beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { testConnection } from '../../tools/utils';

// Global test database pool
let testPool: Pool;

// Initialize test pool if not already created
export function getTestPool(): Pool {
  if (!testPool) {
    testPool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 10, // Smaller pool for testing
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 5000,
    });
  }
  return testPool;
}

// Clean up database state before each test
beforeEach(async () => {
  const pool = getTestPool();
  const client = await pool.connect();
  
  try {
    // Drop all tables that might exist from previous tests
    await client.query(`
      DROP TABLE IF EXISTS orders CASCADE;
      DROP TABLE IF EXISTS products CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS test_types CASCADE;
    `);
    
    // Create fresh test tables
    await createTestSchema(client);
    
  } finally {
    client.release();
  }
  
  // Initialize the global connection status for tools
  await testConnection();
});

// Cleanup after each test (optional - beforeEach handles it)
afterEach(async () => {
  // Could add additional cleanup here if needed
});

// Create standard test schema
async function createTestSchema(client: any) {
  // Users table with various data types
  await client.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(100),
      age INTEGER,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      metadata JSONB,
      tags TEXT[]
    )
  `);
  
  // Products table
  await client.query(`
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      price DECIMAL(10,2),
      in_stock BOOLEAN DEFAULT true,
      category VARCHAR(100),
      tags TEXT[],
      attributes JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  
  // Orders table with foreign keys
  await client.query(`
    CREATE TABLE orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price DECIMAL(10,2) NOT NULL,
      total DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
      status VARCHAR(50) DEFAULT 'pending',
      order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      notes TEXT
    )
  `);
  
  // Test types table for data type testing
  await client.query(`
    CREATE TABLE test_types (
      id SERIAL PRIMARY KEY,
      text_col TEXT,
      int_col INTEGER,
      bool_col BOOLEAN,
      json_col JSONB,
      array_col TEXT[],
      timestamp_col TIMESTAMP WITH TIME ZONE
    )
  `);
  
  // Create indexes for testing
  await client.query('CREATE INDEX idx_users_email ON users(email)');
  await client.query('CREATE INDEX idx_products_category ON products(category)');
  await client.query('CREATE INDEX idx_orders_user_id ON orders(user_id)');
  await client.query('CREATE INDEX idx_orders_status ON orders(status)');
}

// Helper function to insert test data
export async function insertTestData() {
  const pool = getTestPool();
  const client = await pool.connect();
  
  try {
    // Insert test users
    const userResult = await client.query(`
      INSERT INTO users (email, name, age, is_active, metadata, tags) VALUES
      ('john@example.com', 'John Doe', 30, true, '{"role": "admin", "department": "IT"}', ARRAY['developer', 'admin']),
      ('jane@example.com', 'Jane Smith', 25, true, '{"role": "user", "department": "Sales"}', ARRAY['user']),
      ('bob@example.com', 'Bob Johnson', 35, false, '{"role": "user", "department": "HR"}', ARRAY['user', 'hr'])
      RETURNING id
    `);
    
    // Insert test products
    const productResult = await client.query(`
      INSERT INTO products (name, description, price, in_stock, category, tags, attributes) VALUES
      ('Laptop', 'High-performance laptop', 999.99, true, 'Electronics', ARRAY['computer', 'portable'], '{"brand": "TechCorp", "warranty": "2 years"}'),
      ('Mouse', 'Wireless optical mouse', 29.99, true, 'Electronics', ARRAY['accessory', 'wireless'], '{"brand": "TechCorp", "color": "black"}'),
      ('Desk', 'Standing desk', 299.99, false, 'Furniture', ARRAY['office', 'adjustable'], '{"material": "wood", "height": "adjustable"}')
      RETURNING id
    `);
    
    // Insert test orders
    await client.query(`
      INSERT INTO orders (user_id, product_id, quantity, unit_price, status, notes) VALUES
      ($1, $2, 1, 999.99, 'completed', 'Express delivery'),
      ($1, $3, 2, 29.99, 'pending', 'Standard shipping'),
      ($4, $2, 1, 999.99, 'cancelled', 'Changed mind')
    `, [
      userResult.rows[0].id, // John
      productResult.rows[0].id, // Laptop
      productResult.rows[1].id, // Mouse
      userResult.rows[1].id, // Jane
    ]);
    
    return {
      users: userResult.rows,
      products: productResult.rows
    };
    
  } finally {
    client.release();
  }
}

// Helper function to clean database between tests
export async function cleanTestData() {
  const pool = getTestPool();
  const client = await pool.connect();
  
  try {
    await client.query('TRUNCATE orders, products, users, test_types RESTART IDENTITY CASCADE');
  } finally {
    client.release();
  }
}

// Close test pool (for cleanup)
export async function closeTestPool() {
  if (testPool) {
    await testPool.end();
  }
}