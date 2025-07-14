import { describe, it, expect, beforeEach } from 'vitest';
import { connectionStatus, connectionStatusSchema } from '../../../tools/connectionStatus';
import { cleanTestData, getTestPool, insertTestData } from '../../setup/test-setup';
import { executeTestQuery, expectMcpError, expectValidMcpResponse, extractJsonFromMcpResponse } from '../../setup/test-helpers';

describe('connectionStatus Tool', () => {
  beforeEach(async () => {
    await cleanTestData();
    await insertTestData(); // Ensure database is accessible
  });

  describe('Schema Validation', () => {
    it('should validate minimal valid parameters', () => {
      const params = {};
      const result = connectionStatusSchema.parse(params);
      
      expect(result.retry).toBe(false); // default
    });

    it('should validate complete parameters', () => {
      const params = {
        retry: true
      };
      
      const result = connectionStatusSchema.parse(params);
      expect(result).toEqual(params);
    });

    it('should apply default values', () => {
      const params = {};
      const result = connectionStatusSchema.parse(params);
      
      expect(result.retry).toBe(false);
    });

    it('should validate boolean retry parameter', () => {
      expect(() => connectionStatusSchema.parse({ retry: true })).not.toThrow();
      expect(() => connectionStatusSchema.parse({ retry: false })).not.toThrow();
    });
  });

  describe('Basic Connection Status', () => {
    it('should return connection status without retry', async () => {
      const response = await connectionStatus({
        retry: false
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.connection_status).toBeDefined();
      expect(data.message).toBeDefined();
      expect(data.retry_available).toBe(true);
      expect(typeof data.connection_status).toBe('string');
      expect(typeof data.message).toBe('string');
    });

    it('should return connection status by default (no retry)', async () => {
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.connection_status).toBeDefined();
      expect(data.message).toBeDefined();
      expect(data.retry_available).toBe(true);
      expect(data.action).toBeUndefined(); // No retry attempted
    });

    it('should indicate healthy connection when database is accessible', async () => {
      // Since we just ran insertTestData(), connection should be healthy
      const response = await connectionStatus({
        retry: false
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Connection should be healthy since we can run tests
      expect(data.connection_status).toBe('connected');
      expect(data.message).toContain('healthy');
      expect(data.error).toBeNull();
      expect(data.troubleshooting).toBeNull();
    });
  });

  describe('Connection Status Fields', () => {
    it('should include all required status fields', async () => {
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data).toHaveProperty('connection_status');
      expect(data).toHaveProperty('message');
      expect(data).toHaveProperty('retry_available');
      
      // These fields may be present or null depending on status
      expect(data).toHaveProperty('error');
      expect(data).toHaveProperty('last_attempt');
      expect(data).toHaveProperty('troubleshooting');
    });

    it('should have appropriate data types for all fields', async () => {
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(typeof data.connection_status).toBe('string');
      expect(typeof data.message).toBe('string');
      expect(typeof data.retry_available).toBe('boolean');
      
      if (data.error !== null) {
        expect(typeof data.error).toBe('string');
      }
      
      if (data.last_attempt !== null) {
        expect(typeof data.last_attempt).toBe('string');
      }
      
      if (data.troubleshooting !== null) {
        expect(typeof data.troubleshooting).toBe('object');
      }
    });
  });

  describe('Retry Functionality', () => {
    it('should attempt retry when requested', async () => {
      const response = await connectionStatus({
        retry: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.action).toBe('retry_attempted');
      expect(data.connection_status).toBeDefined();
      expect(typeof data.retry_successful).toBe('boolean');
      expect(data.message).toBeDefined();
    });

    it('should indicate successful retry when database is accessible', async () => {
      const response = await connectionStatus({
        retry: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data.action).toBe('retry_attempted');
      expect(data.retry_successful).toBe(true);
      expect(data.connection_status).toBe('connected');
      expect(data.message).toContain('successful');
      expect(data.error).toBeNull();
      expect(data.troubleshooting).toBeNull();
    });

    it('should include retry fields when retry is attempted', async () => {
      const response = await connectionStatus({
        retry: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      expect(data).toHaveProperty('action');
      expect(data).toHaveProperty('retry_successful');
      expect(data.action).toBe('retry_attempted');
      expect(typeof data.retry_successful).toBe('boolean');
    });
  });

  describe('Troubleshooting Information', () => {
    it('should include troubleshooting info structure when present', async () => {
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // If troubleshooting is present, it should have the right structure
      if (data.troubleshooting) {
        expect(data.troubleshooting).toHaveProperty('common_issues');
        expect(data.troubleshooting).toHaveProperty('next_steps');
        expect(Array.isArray(data.troubleshooting.common_issues)).toBe(true);
        expect(Array.isArray(data.troubleshooting.next_steps)).toBe(true);
        
        // Should have useful troubleshooting content
        expect(data.troubleshooting.common_issues.length).toBeGreaterThan(0);
        expect(data.troubleshooting.next_steps.length).toBeGreaterThan(0);
        
        // Check for expected troubleshooting content
        const allIssues = data.troubleshooting.common_issues.join(' ').toLowerCase();
        expect(allIssues).toContain('postgresql');
        expect(allIssues).toContain('database');
        
        const allSteps = data.troubleshooting.next_steps.join(' ').toLowerCase();
        expect(allSteps).toContain('database');
      }
    });

    it('should provide helpful troubleshooting guidance', async () => {
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // For a healthy connection, troubleshooting should be null
      if (data.connection_status === 'connected') {
        expect(data.troubleshooting).toBeNull();
      }
      
      // If there's troubleshooting info, it should be comprehensive
      if (data.troubleshooting) {
        expect(data.troubleshooting.common_issues.length).toBeGreaterThanOrEqual(3);
        expect(data.troubleshooting.next_steps.length).toBeGreaterThanOrEqual(3);
        
        // Should mention key troubleshooting areas
        const issues = data.troubleshooting.common_issues.join(' ');
        expect(issues).toMatch(/server|running|credentials|connectivity|firewall/i);
        
        const steps = data.troubleshooting.next_steps.join(' ');
        expect(steps).toMatch(/configuration|test|logs|retry/i);
      }
    });
  });

  describe('Connection Status Values', () => {
    it('should return valid connection status values', async () => {
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Should be one of the expected status values
      expect(['connected', 'failed', 'unknown']).toContain(data.connection_status);
    });

    it('should provide appropriate messages for different statuses', async () => {
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Message should be appropriate for the status
      if (data.connection_status === 'connected') {
        expect(data.message).toMatch(/healthy|connected|successful/i);
      } else if (data.connection_status === 'failed') {
        expect(data.message).toMatch(/failed|error/i);
      } else if (data.connection_status === 'unknown') {
        expect(data.message).toMatch(/unknown|no.*attempt/i);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle internal errors gracefully', async () => {
      // This test verifies the tool handles unexpected internal errors
      // In normal operation, this should not fail
      const response = await connectionStatus({});
      
      // Should either succeed or fail gracefully
      if (response.isError) {
        expectMcpError(response, /connection status/);
      } else {
        expectValidMcpResponse(response);
      }
    });

    it('should not throw exceptions for any valid input', async () => {
      const testCases = [
        {},
        { retry: false },
        { retry: true }
      ];
      
      for (const testCase of testCases) {
        const response = await connectionStatus(testCase);
        
        // Should return a valid response (success or error) without throwing
        expect(response).toBeDefined();
        expect(response).toHaveProperty('content');
      }
    });
  });

  describe('Performance', () => {
    it('should return status quickly without retry', async () => {
      const startTime = Date.now();
      
      const response = await connectionStatus({
        retry: false
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      expect(duration).toBeLessThan(1000); // Should be very fast
    });

    it('should complete retry operation within reasonable time', async () => {
      const startTime = Date.now();
      
      const response = await connectionStatus({
        retry: true
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expectValidMcpResponse(response);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('Response Format', () => {
    it('should have consistent response structure without retry', async () => {
      const response = await connectionStatus({
        retry: false
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Required fields for non-retry requests
      expect(data).toHaveProperty('connection_status');
      expect(data).toHaveProperty('message');
      expect(data).toHaveProperty('retry_available');
      expect(data).toHaveProperty('error');
      expect(data).toHaveProperty('last_attempt');
      expect(data).toHaveProperty('troubleshooting');
      
      // Should not have retry-specific fields
      expect(data).not.toHaveProperty('action');
      expect(data).not.toHaveProperty('retry_successful');
    });

    it('should have consistent response structure with retry', async () => {
      const response = await connectionStatus({
        retry: true
      });
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Required fields for retry requests
      expect(data).toHaveProperty('action');
      expect(data).toHaveProperty('connection_status');
      expect(data).toHaveProperty('retry_successful');
      expect(data).toHaveProperty('error');
      expect(data).toHaveProperty('last_attempt');
      expect(data).toHaveProperty('message');
      expect(data).toHaveProperty('troubleshooting');
      
      // Verify specific values
      expect(data.action).toBe('retry_attempted');
      expect(typeof data.retry_successful).toBe('boolean');
    });
  });

  describe('Integration with Database Operations', () => {
    it('should accurately reflect database accessibility', async () => {
      // Since we can execute test operations, connection should be reported as healthy
      await executeTestQuery('SELECT 1');
      
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Should report connected status since we can execute queries
      expect(data.connection_status).toBe('connected');
      expect(data.message).toMatch(/healthy|connected/i);
    });

    it('should provide consistent status across multiple calls', async () => {
      const response1 = await connectionStatus({});
      const response2 = await connectionStatus({});
      
      expectValidMcpResponse(response1);
      expectValidMcpResponse(response2);
      
      const data1 = extractJsonFromMcpResponse(response1);
      const data2 = extractJsonFromMcpResponse(response2);
      
      // Status should be consistent
      expect(data1.connection_status).toBe(data2.connection_status);
      
      // If connected, both should report healthy
      if (data1.connection_status === 'connected') {
        expect(data2.connection_status).toBe('connected');
        expect(data1.troubleshooting).toBeNull();
        expect(data2.troubleshooting).toBeNull();
      }
    });
  });

  describe('Utility and Usability', () => {
    it('should provide actionable information', async () => {
      const response = await connectionStatus({});
      
      expectValidMcpResponse(response);
      const data = extractJsonFromMcpResponse(response);
      
      // Should indicate retry is available
      expect(data.retry_available).toBe(true);
      
      // Message should be informative
      expect(data.message.length).toBeGreaterThan(10);
      
      // If troubleshooting is present, it should be actionable
      if (data.troubleshooting) {
        data.troubleshooting.common_issues.forEach((issue: string) => {
          expect(issue.length).toBeGreaterThan(10);
          expect(issue).toMatch(/check|verify|ensure/i);
        });
        
        data.troubleshooting.next_steps.forEach((step: string) => {
          expect(step.length).toBeGreaterThan(10);
          expect(step).toMatch(/review|test|check|use/i);
        });
      }
    });

    it('should differentiate between retry and non-retry responses', async () => {
      const statusResponse = await connectionStatus({ retry: false });
      const retryResponse = await connectionStatus({ retry: true });
      
      expectValidMcpResponse(statusResponse);
      expectValidMcpResponse(retryResponse);
      
      const statusData = extractJsonFromMcpResponse(statusResponse);
      const retryData = extractJsonFromMcpResponse(retryResponse);
      
      // Status-only response should not have action
      expect(statusData.action).toBeUndefined();
      expect(statusData.retry_successful).toBeUndefined();
      
      // Retry response should have action
      expect(retryData.action).toBe('retry_attempted');
      expect(typeof retryData.retry_successful).toBe('boolean');
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid successive calls', async () => {
      // Make multiple rapid calls to test race conditions
      const promises = Array.from({ length: 5 }, () => connectionStatus({}));
      const responses = await Promise.all(promises);
      
      // All should complete successfully
      responses.forEach(response => {
        expectValidMcpResponse(response);
        const data = extractJsonFromMcpResponse(response);
        expect(data.connection_status).toBeDefined();
      });
    });

    it('should handle mixed retry and non-retry calls', async () => {
      const statusCall = connectionStatus({ retry: false });
      const retryCall = connectionStatus({ retry: true });
      
      const [statusResponse, retryResponse] = await Promise.all([statusCall, retryCall]);
      
      expectValidMcpResponse(statusResponse);
      expectValidMcpResponse(retryResponse);
      
      const statusData = extractJsonFromMcpResponse(statusResponse);
      const retryData = extractJsonFromMcpResponse(retryResponse);
      
      expect(statusData.action).toBeUndefined();
      expect(retryData.action).toBe('retry_attempted');
    });
  });
});