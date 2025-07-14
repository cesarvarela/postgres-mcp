import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let globalContainer: StartedPostgreSqlContainer;

export async function setup() {
  console.log('🐳 Starting PostgreSQL testcontainer...');
  
  // Start PostgreSQL container with specific configuration
  globalContainer = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('testdb')
    .withUsername('testuser')
    .withPassword('testpass')
    .withExposedPorts(5432)
    .withStartupTimeout(60000) // 60 seconds timeout
    .start();

  const connectionUri = globalContainer.getConnectionUri();
  console.log(`✅ PostgreSQL container started at: ${connectionUri}`);
  
  // Set environment variables for tests
  process.env.TEST_DATABASE_URL = connectionUri;
  process.env.DATABASE_URL = connectionUri;
  process.env.NODE_ENV = 'test';
  process.env.DEBUG = 'postgres-mcp:test*';
  
  // Ensure the container is healthy
  await verifyConnection();
}

export async function teardown() {
  console.log('🧹 Stopping PostgreSQL testcontainer...');
  
  if (globalContainer) {
    await globalContainer.stop();
    console.log('✅ PostgreSQL container stopped');
  }
}

async function verifyConnection() {
  const { Pool } = await import('pg');
  
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ Database connection verified');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}