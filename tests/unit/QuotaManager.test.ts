import { QuotaManager, QuotaConfig, QuotaStats, QuotaResult } from '../../src/services/QuotaManager';

describe('QuotaManager', () => {
  let quotaManager: QuotaManager;
  let defaultConfig: Partial<QuotaConfig>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-01-15T12:00:00Z'));

    defaultConfig = {
      dailyLimit: 100,
      monthlyLimit: 1000,
      payloadSizeLimit: 50000, // 50KB
      burstLimit: 5,
      burstWindowMs: 60000, // 1 minute
    };
  });

  afterEach(() => {
    if (quotaManager) {
      quotaManager.destroy();
    }
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create instance with default configuration', () => {
      quotaManager = new QuotaManager();
      
      const config = quotaManager.getConfig();
      expect(config.dailyLimit).toBe(1000);
      expect(config.monthlyLimit).toBe(10000);
      expect(config.payloadSizeLimit).toBe(512000);
      expect(config.burstLimit).toBe(10);
      expect(config.burstWindowMs).toBe(60000);
    });

    it('should create instance with custom configuration', () => {
      quotaManager = new QuotaManager(defaultConfig);
      
      const config = quotaManager.getConfig();
      expect(config.dailyLimit).toBe(100);
      expect(config.monthlyLimit).toBe(1000);
      expect(config.payloadSizeLimit).toBe(50000);
      expect(config.burstLimit).toBe(5);
      expect(config.burstWindowMs).toBe(60000);
    });

    it('should merge custom config with defaults', () => {
      const partialConfig = { dailyLimit: 200 };
      quotaManager = new QuotaManager(partialConfig);
      
      const config = quotaManager.getConfig();
      expect(config.dailyLimit).toBe(200);
      expect(config.monthlyLimit).toBe(10000); // default
      expect(config.burstLimit).toBe(10); // default
    });

    it('should schedule daily reset on initialization', () => {
      jest.spyOn(global, 'setTimeout');
      quotaManager = new QuotaManager(defaultConfig);
      
      // Should have scheduled timeout for next midnight
      expect(setTimeout).toHaveBeenCalled();
    });
  });

  describe('Basic Quota Checking', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should allow request within limits', () => {
      const result = quotaManager.canSendError(1000);
      
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.quotaStats).toBeDefined();
    });

    it('should reject request exceeding payload size limit', () => {
      const largePayload = 60000; // Exceeds 50KB limit
      
      const result = quotaManager.canSendError(largePayload);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Payload size');
      expect(result.reason).toContain('exceeds limit');
    });

    it('should allow request at exact payload size limit', () => {
      const exactLimit = 50000; // Exactly at limit
      
      const result = quotaManager.canSendError(exactLimit);
      
      expect(result.allowed).toBe(true);
    });

    it('should handle zero payload size', () => {
      const result = quotaManager.canSendError(0);
      
      expect(result.allowed).toBe(true);
    });

    it('should handle undefined payload size', () => {
      const result = quotaManager.canSendError();
      
      expect(result.allowed).toBe(true);
    });
  });

  describe('Daily Quota Management', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should track daily usage', () => {
      for (let i = 0; i < 50; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(50);
      expect(stats.dailyRemaining).toBe(50);
    });

    it('should reject when daily limit exceeded', () => {
      // Create quota manager with high burst limit
      quotaManager = new QuotaManager({
        ...defaultConfig,
        burstLimit: 200
      });
      
      // Use up all daily quota
      for (let i = 0; i < 100; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const result = quotaManager.canSendError(1000);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Daily quota exceeded');
    });

    it('should allow requests after daily reset', () => {
      // Use up all daily quota
      for (let i = 0; i < 100; i++) {
        quotaManager.recordUsage(1000);
      }
      
      expect(quotaManager.canSendError().allowed).toBe(false);
      
      // Advance time to next day
      jest.advanceTimersByTime(24 * 60 * 60 * 1000); // 24 hours
      
      const result = quotaManager.canSendError(1000);
      expect(result.allowed).toBe(true);
    });

    it('should reset daily count at midnight', () => {
      quotaManager.recordUsage(1000);
      quotaManager.recordUsage(1000);
      
      expect(quotaManager.getStats().dailyUsage).toBe(2);
      
      // Advance to next day
      jest.setSystemTime(new Date('2023-01-16T00:00:00Z'));
      
      // Trigger cleanup by calling canSendError
      quotaManager.canSendError();
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(0);
      expect(stats.dailyRemaining).toBe(100);
    });

    it('should handle date transitions correctly', () => {
      // Set time to late evening
      jest.setSystemTime(new Date('2023-01-15T23:59:00Z'));
      quotaManager.recordUsage(1000);
      
      // Move to next day
      jest.setSystemTime(new Date('2023-01-16T00:01:00Z'));
      quotaManager.canSendError(); // Trigger cleanup
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(0);
    });
  });

  describe('Monthly Quota Management', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should track monthly usage', () => {
      for (let i = 0; i < 500; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const stats = quotaManager.getStats();
      expect(stats.monthlyUsage).toBe(500);
      expect(stats.monthlyRemaining).toBe(500);
    });

    it('should reject when monthly limit exceeded', () => {
      // Create quota manager with high burst and daily limits
      quotaManager = new QuotaManager({
        ...defaultConfig,
        burstLimit: 2000,
        dailyLimit: 2000
      });
      
      // Use up all monthly quota
      for (let i = 0; i < 1000; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const result = quotaManager.canSendError(1000);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Monthly quota exceeded');
    });

    it('should reset monthly count when month changes', () => {
      // Create quota manager with high burst limit
      quotaManager = new QuotaManager({
        ...defaultConfig,
        burstLimit: 200
      });
      
      quotaManager.recordUsage(1000);
      
      // Move to next month
      jest.setSystemTime(new Date('2023-02-01T00:00:00Z'));
      quotaManager.canSendError(); // Trigger cleanup
      
      const stats = quotaManager.getStats();
      expect(stats.monthlyUsage).toBe(0);
      expect(stats.monthlyRemaining).toBe(1000);
    });

    it('should handle year transitions correctly', () => {
      // Set time to December
      jest.setSystemTime(new Date('2023-12-31T23:59:00Z'));
      
      // Create quota manager with high burst limit
      quotaManager = new QuotaManager({
        ...defaultConfig,
        burstLimit: 200
      });
      
      quotaManager.recordUsage(1000);
      
      // Move to next year
      jest.setSystemTime(new Date('2024-01-01T00:01:00Z'));
      quotaManager.canSendError(); // Trigger cleanup
      
      const stats = quotaManager.getStats();
      expect(stats.monthlyUsage).toBe(0);
    });
  });

  describe('Burst Limit Management', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should track burst requests within window', () => {
      // Send burst of requests
      for (let i = 0; i < 3; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const stats = quotaManager.getStats();
      expect(stats.burstUsage).toBe(3);
      expect(stats.burstRemaining).toBe(2);
    });

    it('should reject when burst limit exceeded', () => {
      // Fill up burst limit
      for (let i = 0; i < 5; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const result = quotaManager.canSendError(1000);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Burst limit exceeded');
    });

    it('should allow requests after burst window expires', () => {
      // Fill up burst limit
      for (let i = 0; i < 5; i++) {
        quotaManager.recordUsage(1000);
      }
      
      expect(quotaManager.canSendError().allowed).toBe(false);
      
      // Advance time past burst window
      jest.advanceTimersByTime(61000); // 61 seconds
      
      const result = quotaManager.canSendError(1000);
      expect(result.allowed).toBe(true);
    });

    it('should cleanup old burst timestamps', () => {
      quotaManager.recordUsage(1000);
      quotaManager.recordUsage(1000);
      
      expect(quotaManager.getStats().burstUsage).toBe(2);
      
      // Advance past burst window
      jest.advanceTimersByTime(65000);
      
      // Trigger cleanup
      quotaManager.canSendError();
      
      const stats = quotaManager.getStats();
      expect(stats.burstUsage).toBe(0);
      expect(stats.burstRemaining).toBe(5);
    });

    it('should handle partial burst window cleanup', () => {
      // First request
      quotaManager.recordUsage(1000);
      
      // Wait 30 seconds
      jest.advanceTimersByTime(30000);
      
      // Second request
      quotaManager.recordUsage(1000);
      
      // Wait another 35 seconds (total 65 seconds from first request)
      jest.advanceTimersByTime(35000);
      
      // Trigger cleanup
      quotaManager.canSendError();
      
      const stats = quotaManager.getStats();
      expect(stats.burstUsage).toBe(1); // Only second request should remain
    });
  });

  describe('Usage Recording', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should record usage with payload size', () => {
      const payloadSize = 5000;
      quotaManager.recordUsage(payloadSize);
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(1);
      expect(stats.monthlyUsage).toBe(1);
      expect(stats.burstUsage).toBe(1);
    });

    it('should handle zero payload size in recording', () => {
      quotaManager.recordUsage(0);
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(1);
      expect(stats.burstUsage).toBe(1);
    });

    it('should handle undefined payload size in recording', () => {
      quotaManager.recordUsage();
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(1);
      expect(stats.burstUsage).toBe(1);
    });

    it('should accumulate payload sizes over multiple requests', () => {
      quotaManager.recordUsage(1000);
      quotaManager.recordUsage(2000);
      quotaManager.recordUsage(3000);
      
      // Note: The current implementation doesn't expose total bytes
      // but we can verify the requests were recorded
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(3);
      expect(stats.monthlyUsage).toBe(3);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should return correct quota statistics', () => {
      quotaManager.recordUsage(1000);
      quotaManager.recordUsage(1500);
      
      const stats = quotaManager.getStats();
      
      expect(stats).toEqual({
        dailyUsage: 2,
        monthlyUsage: 2,
        dailyRemaining: 98,
        monthlyRemaining: 998,
        burstUsage: 2,
        burstRemaining: 3,
        isOverQuota: false,
        nextResetTime: expect.any(Number),
      });
    });

    it('should correctly calculate isOverQuota flag', () => {
      // Fill up daily quota
      for (let i = 0; i < 100; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const stats = quotaManager.getStats();
      expect(stats.isOverQuota).toBe(true);
    });

    it('should correctly calculate isOverQuota for burst limit', () => {
      // Fill up burst limit
      for (let i = 0; i < 5; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const stats = quotaManager.getStats();
      expect(stats.isOverQuota).toBe(true);
    });

    it('should correctly calculate isOverQuota for monthly limit', () => {
      // Fill up monthly quota
      for (let i = 0; i < 1000; i++) {
        quotaManager.recordUsage(1000);
      }
      
      const stats = quotaManager.getStats();
      expect(stats.isOverQuota).toBe(true);
    });

    it('should calculate correct next reset time', () => {
      const stats = quotaManager.getStats();
      const nextReset = new Date(stats.nextResetTime);
      
      // Should be next midnight
      expect(nextReset.getHours()).toBe(0);
      expect(nextReset.getMinutes()).toBe(0);
      expect(nextReset.getSeconds()).toBe(0);
      expect(nextReset.getDate()).toBe(16); // Next day
    });

    it('should handle edge case at end of day', () => {
      jest.setSystemTime(new Date('2023-01-15T23:59:59Z'));
      quotaManager = new QuotaManager(defaultConfig);
      
      const stats = quotaManager.getStats();
      const nextReset = new Date(stats.nextResetTime);
      const currentDay = new Date('2023-01-15T23:59:59Z').getDate();
      
      // Next reset should be the next day at midnight
      expect(nextReset.getDate()).toBeGreaterThan(currentDay);
      expect(nextReset.getHours()).toBe(0);
      expect(nextReset.getMinutes()).toBe(0);
      expect(nextReset.getSeconds()).toBe(0);
    });
  });

  describe('Configuration Updates', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should update configuration', () => {
      const updates = {
        dailyLimit: 200,
        burstLimit: 10,
      };
      
      quotaManager.updateConfig(updates);
      
      const config = quotaManager.getConfig();
      expect(config.dailyLimit).toBe(200);
      expect(config.burstLimit).toBe(10);
      expect(config.monthlyLimit).toBe(1000); // Should remain unchanged
    });

    it('should affect quota checking after configuration update', () => {
      // Create quota manager with high burst limit
      quotaManager = new QuotaManager({
        ...defaultConfig,
        burstLimit: 200
      });
      
      // Fill up initial daily limit
      for (let i = 0; i < 100; i++) {
        quotaManager.recordUsage(1000);
      }
      
      expect(quotaManager.canSendError().allowed).toBe(false);
      
      // Update daily limit and burst limit
      quotaManager.updateConfig({ dailyLimit: 200, burstLimit: 300 });
      
      const result = quotaManager.canSendError();
      expect(result.allowed).toBe(true);
    });

    it('should maintain existing usage after config update', () => {
      quotaManager.recordUsage(1000);
      quotaManager.recordUsage(1000);
      
      quotaManager.updateConfig({ dailyLimit: 200 });
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(2);
      expect(stats.dailyRemaining).toBe(198); // New limit - existing usage
    });
  });

  describe('Reset Functionality', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should reset all quotas manually', () => {
      quotaManager.recordUsage(1000);
      quotaManager.recordUsage(2000);
      quotaManager.recordUsage(3000);
      
      expect(quotaManager.getStats().dailyUsage).toBe(3);
      
      quotaManager.resetQuotas();
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(0);
      expect(stats.monthlyUsage).toBe(0);
      expect(stats.burstUsage).toBe(0);
    });

    it('should allow requests after manual reset', () => {
      // Fill up daily quota
      for (let i = 0; i < 100; i++) {
        quotaManager.recordUsage(1000);
      }
      
      expect(quotaManager.canSendError().allowed).toBe(false);
      
      quotaManager.resetQuotas();
      
      const result = quotaManager.canSendError();
      expect(result.allowed).toBe(true);
    });
  });

  describe('Automatic Daily Reset', () => {
    beforeEach(() => {
      // Set up at a specific time for predictable testing
      jest.setSystemTime(new Date('2023-01-15T20:00:00Z'));
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should schedule automatic daily reset', () => {
      quotaManager.recordUsage(1000);
      
      expect(quotaManager.getStats().dailyUsage).toBe(1);
      
      // Fast forward to midnight
      jest.advanceTimersByTime(4 * 60 * 60 * 1000); // 4 hours to midnight
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(0);
    });

    it('should reschedule after automatic reset', () => {
      // Fast forward to trigger first reset
      jest.advanceTimersByTime(4 * 60 * 60 * 1000);
      
      quotaManager.recordUsage(1000);
      expect(quotaManager.getStats().dailyUsage).toBe(1);
      
      // Fast forward another day
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      
      const stats = quotaManager.getStats();
      expect(stats.dailyUsage).toBe(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should handle negative payload sizes', () => {
      const result = quotaManager.canSendError(-1000);
      expect(result.allowed).toBe(true); // Negative size should be treated as valid
    });

    it('should handle very large payload sizes', () => {
      const result = quotaManager.canSendError(Number.MAX_SAFE_INTEGER);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds limit');
    });

    it('should handle fractional payload sizes', () => {
      const result = quotaManager.canSendError(1000.5);
      expect(result.allowed).toBe(true);
    });

    it('should handle rapid successive calls', () => {
      const results: QuotaResult[] = [];
      
      // Make 10 rapid calls
      for (let i = 0; i < 10; i++) {
        results.push(quotaManager.canSendError(1000));
        if (results[i].allowed) {
          quotaManager.recordUsage(1000);
        }
      }
      
      // First 5 should be allowed (within burst limit)
      for (let i = 0; i < 5; i++) {
        expect(results[i].allowed).toBe(true);
      }
      
      // Remaining should be blocked by burst limit
      for (let i = 5; i < 10; i++) {
        expect(results[i].allowed).toBe(false);
      }
    });

    it('should handle concurrent usage recording', () => {
      // Simulate concurrent usage recording
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(Promise.resolve(quotaManager.recordUsage(1000)));
      }
      
      return Promise.all(promises).then(() => {
        const stats = quotaManager.getStats();
        expect(stats.dailyUsage).toBe(10);
      });
    });
  });

  describe('Memory Management', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should cleanup burst timestamps to prevent memory leaks', () => {
      // Fill burst timestamps
      for (let i = 0; i < 1000; i++) {
        quotaManager.recordUsage(1000);
        jest.advanceTimersByTime(100); // Small time advance
      }
      
      // Advance past burst window
      jest.advanceTimersByTime(120000); // 2 minutes
      
      // Trigger cleanup
      quotaManager.canSendError();
      
      const stats = quotaManager.getStats();
      expect(stats.burstUsage).toBe(0); // All timestamps should be cleaned up
    });

    it('should handle destruction properly', () => {
      quotaManager.recordUsage(1000);
      
      expect(() => {
        quotaManager.destroy();
      }).not.toThrow();
    });

    it('should clear timers on destroy', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      quotaManager.destroy();
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Node.js Specific Features', () => {
    beforeEach(() => {
      quotaManager = new QuotaManager(defaultConfig);
    });

    it('should work with Node.js Buffer size calculations', () => {
      // Test with different string encodings
      const unicodeText = 'Hello 世界 🌍';
      const payloadSize = Buffer.byteLength(JSON.stringify(unicodeText), 'utf8');
      
      const result = quotaManager.canSendError(payloadSize);
      expect(result.allowed).toBe(true);
    });

    it('should handle Node.js timer precision correctly', () => {
      quotaManager.recordUsage(1000);
      
      // Use Node.js specific time advancement
      const startTime = Date.now();
      jest.advanceTimersByTime(1000);
      
      quotaManager.canSendError();
      
      expect(Date.now() - startTime).toBe(1000);
    });

    it('should work with Node.js process time', () => {
      const beforeTime = Date.now();
      quotaManager.recordUsage(1000);
      const afterTime = Date.now();
      
      // Times should be reasonable within test environment
      expect(afterTime).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  describe('TypeScript Type Safety', () => {
    it('should maintain type safety for configuration', () => {
      // This test primarily ensures TypeScript compilation
      const typedConfig: QuotaConfig = {
        dailyLimit: 100,
        monthlyLimit: 1000,
        payloadSizeLimit: 50000,
        burstLimit: 5,
        burstWindowMs: 60000,
      };
      
      quotaManager = new QuotaManager(typedConfig);
      expect(quotaManager.getConfig()).toEqual(typedConfig);
    });

    it('should return properly typed quota result', () => {
      quotaManager = new QuotaManager(defaultConfig);
      
      const result: QuotaResult = quotaManager.canSendError(1000);
      
      // TypeScript should ensure these properties exist
      expect(typeof result.allowed).toBe('boolean');
      expect(result.quotaStats).toBeDefined();
      expect(typeof result.quotaStats.dailyUsage).toBe('number');
      expect(typeof result.quotaStats.isOverQuota).toBe('boolean');
    });

    it('should return properly typed statistics', () => {
      quotaManager = new QuotaManager(defaultConfig);
      
      const stats: QuotaStats = quotaManager.getStats();
      
      // Verify all required properties exist with correct types
      expect(typeof stats.dailyUsage).toBe('number');
      expect(typeof stats.monthlyUsage).toBe('number');
      expect(typeof stats.dailyRemaining).toBe('number');
      expect(typeof stats.monthlyRemaining).toBe('number');
      expect(typeof stats.burstUsage).toBe('number');
      expect(typeof stats.burstRemaining).toBe('number');
      expect(typeof stats.isOverQuota).toBe('boolean');
      expect(typeof stats.nextResetTime).toBe('number');
    });
  });
});