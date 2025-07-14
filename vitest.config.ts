import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use Node.js environment for database testing
    environment: 'node',
    
    // Global setup/teardown for testcontainers
    globalSetup: ['./tests/setup/global-setup.ts'],
    
    // Setup files run before each test file
    setupFiles: ['./tests/setup/test-setup.ts'],
    
    // Extended timeouts for container operations
    testTimeout: 30000, // 30 seconds for individual tests
    hookTimeout: 60000, // 60 seconds for setup/teardown hooks
    
    // Test file patterns
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['tools/**/*.ts', 'index.ts'],
      exclude: ['tests/**', 'dist/**', '**/*.d.ts'],
      thresholds: {
        global: {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90
        }
      }
    },
    
    // Disable parallelization to avoid test isolation issues
    pool: 'threads',
    poolOptions: {
      threads: {
        // Force single thread to avoid race conditions
        maxThreads: 1,
        minThreads: 1
      }
    }
  }
});