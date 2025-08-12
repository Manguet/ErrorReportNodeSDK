import { RetryManager, RetryConfig, RetryStats } from '../../src/services/RetryManager';

describe('RetryManager', () => {
  let retryManager: RetryManager;
  let defaultConfig: Partial<RetryConfig>;

  beforeEach(() => {
    jest.useFakeTimers();
    
    defaultConfig = {
      maxAttempts: 3,
      delay: 1000,
      exponentialBase: 2,
      maxDelay: 30000,
      jitter: false, // Disable jitter for predictable testing
    };
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Constructor and Configuration', () => {
    it('should create instance with default configuration', () => {
      retryManager = new RetryManager();
      
      const config = retryManager.getConfig();
      expect(config.maxAttempts).toBe(3);
      expect(config.delay).toBe(1000);
      expect(config.exponentialBase).toBe(2);
      expect(config.maxDelay).toBe(30000);
      expect(config.jitter).toBe(true);
    });

    it('should create instance with custom configuration', () => {
      retryManager = new RetryManager(defaultConfig);
      
      const config = retryManager.getConfig();
      expect(config.maxAttempts).toBe(3);
      expect(config.delay).toBe(1000);
      expect(config.exponentialBase).toBe(2);
      expect(config.maxDelay).toBe(30000);
      expect(config.jitter).toBe(false);
    });

    it('should merge custom config with defaults', () => {
      const partialConfig = { maxAttempts: 5 };
      retryManager = new RetryManager(partialConfig);
      
      const config = retryManager.getConfig();
      expect(config.maxAttempts).toBe(5);
      expect(config.delay).toBe(1000); // default
      expect(config.jitter).toBe(true); // default
    });

    it('should initialize stats correctly', () => {
      retryManager = new RetryManager(defaultConfig);
      
      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(0);
      expect(stats.successfulRetries).toBe(0);
      expect(stats.failedRetries).toBe(0);
      expect(stats.averageAttempts).toBe(0);
    });
  });

  describe('Basic Retry Logic', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should execute operation successfully on first attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const result = await retryManager.executeWithRetry(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry failed operations', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success');

      const promise = retryManager.executeWithRetry(mockOperation);
      
      // Fast forward through delays
      jest.advanceTimersByTime(1000); // First retry delay
      await Promise.resolve(); // Allow promise to resolve
      jest.advanceTimersByTime(2000); // Second retry delay (exponential)
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should fail after max attempts', async () => {
      const error = new Error('Persistent failure');
      const mockOperation = jest.fn().mockRejectedValue(error);
      
      const promise = retryManager.executeWithRetry(mockOperation);
      
      // Fast forward through all retry delays
      jest.advanceTimersByTime(1000); // First retry
      await Promise.resolve();
      jest.advanceTimersByTime(2000); // Second retry
      await Promise.resolve();
      
      await expect(promise).rejects.toThrow('Persistent failure');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should throw the last error after all retries fail', async () => {
      const errors = [
        new Error('First error'),
        new Error('Second error'), 
        new Error('Final error')
      ];
      
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(errors[0])
        .mockRejectedValueOnce(errors[1])
        .mockRejectedValueOnce(errors[2]);
      
      const promise = retryManager.executeWithRetry(mockOperation);
      
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      
      await expect(promise).rejects.toThrow('Final error');
    });
  });

  describe('Delay Calculation', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should use exponential backoff', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Test error'));
      const delays: number[] = [];
      
      // Mock setTimeout to capture delays
      const originalSetTimeout = setTimeout;
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any, delay?: number) => {
        delays.push(delay);
        return originalSetTimeout(callback, 0); // Execute immediately
      });

      try {
        await retryManager.executeWithRetry(mockOperation);
      } catch (e) {
        // Expected to fail
      }
      
      expect(delays).toEqual([1000, 2000]); // 1000 * 2^0, 1000 * 2^1
    });

    it('should respect maximum delay limit', async () => {
      const shortMaxDelayConfig = {
        ...defaultConfig,
        maxDelay: 1500,
      };
      retryManager = new RetryManager(shortMaxDelayConfig);
      
      const mockOperation = jest.fn().mockRejectedValue(new Error('Test error'));
      const delays: number[] = [];
      
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any, delay?: number) => {
        delays.push(delay);
        return setTimeout(callback, 0);
      });

      try {
        await retryManager.executeWithRetry(mockOperation);
      } catch (e) {
        // Expected to fail
      }
      
      expect(delays[0]).toBe(1000); // First delay under max
      expect(delays[1]).toBe(1500); // Second delay capped at maxDelay
    });

    it('should apply jitter when enabled', async () => {
      const jitterConfig = {
        ...defaultConfig,
        jitter: true,
      };
      retryManager = new RetryManager(jitterConfig);
      
      const mockOperation = jest.fn().mockRejectedValue(new Error('Test error'));
      const delays: number[] = [];
      
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any, delay?: number) => {
        delays.push(delay);
        return setTimeout(callback, 0);
      });

      try {
        await retryManager.executeWithRetry(mockOperation);
      } catch (e) {
        // Expected to fail
      }
      
      // With jitter, delays should be between 50% and 100% of calculated value
      expect(delays[0]).toBeGreaterThanOrEqual(500); // At least 50% of 1000
      expect(delays[0]).toBeLessThanOrEqual(1000); // At most 100% of 1000
      
      expect(delays[1]).toBeGreaterThanOrEqual(1000); // At least 50% of 2000
      expect(delays[1]).toBeLessThanOrEqual(2000); // At most 100% of 2000
    });

    it('should handle custom exponential base', async () => {
      const customBaseConfig = {
        ...defaultConfig,
        exponentialBase: 3,
      };
      retryManager = new RetryManager(customBaseConfig);
      
      const mockOperation = jest.fn().mockRejectedValue(new Error('Test error'));
      const delays: number[] = [];
      
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any, delay?: number) => {
        delays.push(delay);
        return setTimeout(callback, 0);
      });

      try {
        await retryManager.executeWithRetry(mockOperation);
      } catch (e) {
        // Expected to fail
      }
      
      expect(delays).toEqual([1000, 3000]); // 1000 * 3^0, 1000 * 3^1
    });
  });

  describe('Retry with Callback', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should call retry callback on each retry attempt', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue('success');
      
      const retryCallback = jest.fn();
      
      const promise = retryManager.executeWithCallback(mockOperation, retryCallback);
      
      jest.advanceTimersByTime(1000);
      const result = await promise;
      
      expect(result).toBe('success');
      expect(retryCallback).toHaveBeenCalledWith(1, new Error('First failure'));
    });

    it('should not call callback on successful first attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      const retryCallback = jest.fn();
      
      const result = await retryManager.executeWithCallback(mockOperation, retryCallback);
      
      expect(result).toBe('success');
      expect(retryCallback).not.toHaveBeenCalled();
    });

    it('should call callback for each failed attempt', async () => {
      const errors = [
        new Error('First failure'),
        new Error('Second failure')
      ];
      
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(errors[0])
        .mockRejectedValueOnce(errors[1])
        .mockResolvedValue('success');
      
      const retryCallback = jest.fn();
      
      const promise = retryManager.executeWithCallback(mockOperation, retryCallback);
      
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(retryCallback).toHaveBeenCalledTimes(2);
      expect(retryCallback).toHaveBeenNthCalledWith(1, 1, errors[0]);
      expect(retryCallback).toHaveBeenNthCalledWith(2, 2, errors[1]);
    });

    it('should handle callback that throws errors', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Operation failure'))
        .mockResolvedValue('success');
      
      const retryCallback = jest.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      
      const promise = retryManager.executeWithCallback(mockOperation, retryCallback);
      
      jest.advanceTimersByTime(1000);
      
      const result = await promise;
      
      // Should still succeed despite callback error
      expect(result).toBe('success');
      expect(retryCallback).toHaveBeenCalled();
    });
  });

  describe('HTTP-Specific Retry', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should retry HTTP operation with custom retryable error check', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('HTTP 503'))
        .mockResolvedValue('success');
      
      const isRetryableError = jest.fn().mockReturnValue(true);
      
      const promise = retryManager.executeHttpRequest(mockOperation, isRetryableError);
      
      jest.advanceTimersByTime(1000);
      const result = await promise;
      
      expect(result).toBe('success');
      expect(isRetryableError).toHaveBeenCalledWith(new Error('HTTP 503'));
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('HTTP 400');
      const mockOperation = jest.fn().mockRejectedValue(error);
      const isRetryableError = jest.fn().mockReturnValue(false);
      
      const promise = retryManager.executeHttpRequest(mockOperation, isRetryableError);
      
      await expect(promise).rejects.toThrow('HTTP 400');
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(isRetryableError).toHaveBeenCalledWith(error);
    });

    it('should use built-in retryable error detection', async () => {
      const retryableErrors = [
        new Error('ECONNRESET'),
        new Error('ENOTFOUND'),
        new Error('ETIMEDOUT'),
        new Error('ECONNREFUSED'),
        new Error('HTTP 408'),
        new Error('HTTP 429'),
        new Error('HTTP 502'),
        new Error('HTTP 503'),
        new Error('HTTP 504'),
      ];

      for (const error of retryableErrors) {
        expect(retryManager.isRetryableError(error)).toBe(true);
      }
    });

    it('should not retry non-retryable HTTP errors', () => {
      const nonRetryableErrors = [
        new Error('HTTP 400'),
        new Error('HTTP 401'),
        new Error('HTTP 403'),
        new Error('HTTP 404'),
        new Error('Some other error'),
      ];

      for (const error of nonRetryableErrors) {
        expect(retryManager.isRetryableError(error)).toBe(false);
      }
    });

    it('should extract HTTP status codes correctly', () => {
      const httpErrors = [
        { error: new Error('HTTP 408: Request Timeout'), expected: true },
        { error: new Error('Request failed with status 503'), expected: false },
        { error: new Error('HTTP 502'), expected: true },
        { error: new Error('Status: 429'), expected: false },
      ];

      for (const { error, expected } of httpErrors) {
        expect(retryManager.isRetryableError(error)).toBe(expected);
      }
    });

    it('should log retry attempts for HTTP requests', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('HTTP 503'))
        .mockResolvedValue('success');
      
      const promise = retryManager.executeHttpRequest(mockOperation);
      
      jest.advanceTimersByTime(1000);
      const result = await promise;
      
      expect(result).toBe('success');
      expect(consoleSpy).toHaveBeenCalledWith(
        'HTTP request failed (attempt 1), retrying...',
        expect.objectContaining({
          error: 'HTTP 503',
          nextRetryIn: 2000, // Next retry delay
        })
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Statistics Tracking', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should track successful operations without retries', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      await retryManager.executeWithRetry(mockOperation);
      
      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(1);
      expect(stats.successfulRetries).toBe(0);
      expect(stats.failedRetries).toBe(0);
      expect(stats.averageAttempts).toBe(1);
    });

    it('should track successful operations with retries', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Failure'))
        .mockResolvedValue('success');
      
      const promise = retryManager.executeWithRetry(mockOperation);
      jest.advanceTimersByTime(1000);
      await promise;
      
      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(2);
      expect(stats.successfulRetries).toBe(1);
      expect(stats.failedRetries).toBe(0);
      expect(stats.averageAttempts).toBe(2);
    });

    it('should track failed operations after all retries', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Failure'));
      
      const promise = retryManager.executeWithRetry(mockOperation);
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      
      try {
        await promise;
      } catch (e) {
        // Expected
      }
      
      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(3);
      expect(stats.successfulRetries).toBe(0);
      expect(stats.failedRetries).toBe(1);
      expect(stats.averageAttempts).toBe(3);
    });

    it('should calculate average attempts correctly', async () => {
      // First operation: success on first try
      await retryManager.executeWithRetry(jest.fn().mockResolvedValue('success'));
      
      // Second operation: success on second try
      const secondOp = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');
      
      const promise = retryManager.executeWithRetry(secondOp);
      jest.advanceTimersByTime(1000);
      await promise;
      
      // Third operation: fail after all attempts
      const thirdOp = jest.fn().mockRejectedValue(new Error('Fail'));
      const failPromise = retryManager.executeWithRetry(thirdOp);
      
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      
      try {
        await failPromise;
      } catch (e) {
        // Expected
      }
      
      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(6); // 1 + 2 + 3
      expect(stats.successfulRetries).toBe(1);
      expect(stats.failedRetries).toBe(1);
      expect(stats.averageAttempts).toBe(3); // 6 attempts / 2 completed operations
    });

    it('should reset statistics correctly', () => {
      retryManager.executeWithRetry(jest.fn().mockResolvedValue('success'));
      
      expect(retryManager.getStats().totalAttempts).toBeGreaterThan(0);
      
      retryManager.resetStats();
      
      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(0);
      expect(stats.successfulRetries).toBe(0);
      expect(stats.failedRetries).toBe(0);
      expect(stats.averageAttempts).toBe(0);
    });
  });

  describe('Configuration Management', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should update configuration', () => {
      const updates = {
        maxAttempts: 5,
        delay: 2000,
      };
      
      retryManager.updateConfig(updates);
      
      const config = retryManager.getConfig();
      expect(config.maxAttempts).toBe(5);
      expect(config.delay).toBe(2000);
      expect(config.exponentialBase).toBe(2); // Should remain unchanged
    });

    it('should affect retry behavior after configuration update', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Failure'));
      
      // Update to only allow 2 attempts
      retryManager.updateConfig({ maxAttempts: 2 });
      
      const promise = retryManager.executeWithRetry(mockOperation);
      
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      
      try {
        await promise;
      } catch (e) {
        // Expected
      }
      
      expect(mockOperation).toHaveBeenCalledTimes(2); // Only 2 attempts due to config update
    });

    it('should return current configuration', () => {
      const config = retryManager.getConfig();
      expect(config).toEqual(defaultConfig);
    });
  });

  describe('Error Handling Edge Cases', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should handle operations that return undefined', async () => {
      const mockOperation = jest.fn().mockResolvedValue(undefined);
      
      const result = await retryManager.executeWithRetry(mockOperation);
      
      expect(result).toBeUndefined();
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle operations that return null', async () => {
      const mockOperation = jest.fn().mockResolvedValue(null);
      
      const result = await retryManager.executeWithRetry(mockOperation);
      
      expect(result).toBeNull();
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle operations that throw non-Error objects', async () => {
      const mockOperation = jest.fn().mockRejectedValue('String error');
      
      const promise = retryManager.executeWithRetry(mockOperation);
      
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      
      await expect(promise).rejects.toBe('String error');
    });

    it('should handle operations that throw null', async () => {
      const mockOperation = jest.fn().mockRejectedValue(null);
      
      const promise = retryManager.executeWithRetry(mockOperation);
      
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      
      await expect(promise).rejects.toBeNull();
    });

    it('should handle very large delay values', () => {
      const config = {
        maxAttempts: 2,
        delay: Number.MAX_SAFE_INTEGER,
        exponentialBase: 2,
        maxDelay: 1000, // Should cap the delay
      };
      
      retryManager = new RetryManager(config);
      
      const mockOperation = jest.fn().mockRejectedValue(new Error('Test'));
      const delays: number[] = [];
      
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any, delay?: number) => {
        delays.push(delay);
        return setTimeout(callback, 0);
      });
      
      retryManager.executeWithRetry(mockOperation).catch(() => {});
      
      expect(delays[0]).toBe(1000); // Should be capped by maxDelay
    });
  });

  describe('Concurrency and Race Conditions', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should handle concurrent operations correctly', async () => {
      const operations = [
        jest.fn().mockResolvedValue('result1'),
        jest.fn().mockResolvedValue('result2'),
        jest.fn().mockResolvedValue('result3'),
      ];
      
      const promises = operations.map(op => retryManager.executeWithRetry(op));
      const results = await Promise.all(promises);
      
      expect(results).toEqual(['result1', 'result2', 'result3']);
      operations.forEach((op, index) => {
        expect(op).toHaveBeenCalledTimes(1);
      });
    });

    it('should maintain separate retry state for concurrent operations', async () => {
      const op1 = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success1');
      
      const op2 = jest.fn().mockResolvedValue('success2');
      
      const promise1 = retryManager.executeWithRetry(op1);
      const promise2 = retryManager.executeWithRetry(op2);
      
      // Advance time for first operation's retry
      jest.advanceTimersByTime(1000);
      
      const results = await Promise.all([promise1, promise2]);
      
      expect(results).toEqual(['success1', 'success2']);
      expect(op1).toHaveBeenCalledTimes(2); // Failed once, then succeeded
      expect(op2).toHaveBeenCalledTimes(1); // Succeeded immediately
    });

    it('should not interfere with statistics from concurrent operations', async () => {
      const operations = Array.from({ length: 5 }, () => 
        jest.fn().mockResolvedValue('success')
      );
      
      const promises = operations.map(op => retryManager.executeWithRetry(op));
      await Promise.all(promises);
      
      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(5);
      expect(stats.successfulRetries).toBe(0);
      expect(stats.failedRetries).toBe(0);
    });
  });

  describe('Node.js Specific Features', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should work with Node.js timers correctly', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');
      
      const startTime = Date.now();
      const promise = retryManager.executeWithRetry(mockOperation);
      
      jest.advanceTimersByTime(1000);
      await promise;
      
      expect(Date.now() - startTime).toBe(1000);
    });

    it('should handle Node.js error objects correctly', async () => {
      const nodeError = new Error('ECONNRESET');
      nodeError.name = 'SystemError';
      (nodeError as any).code = 'ECONNRESET';
      
      expect(retryManager.isRetryableError(nodeError)).toBe(true);
    });

    it('should work with Buffer and Stream operations', async () => {
      const mockStreamOperation = jest.fn().mockImplementation(() => {
        return Promise.resolve(Buffer.from('test data'));
      });
      
      const result = await retryManager.executeWithRetry(mockStreamOperation);
      
      expect(Buffer.isBuffer(result)).toBe(true);
      expect((result as Buffer).toString()).toBe('test data');
    });

    it('should handle process-related timing correctly', () => {
      // Test that the retry manager works with Node.js process timing
      const startTime = process.hrtime();
      
      retryManager.executeWithRetry(jest.fn().mockResolvedValue('success'));
      
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const milliseconds = seconds * 1000 + nanoseconds / 1000000;
      
      expect(milliseconds).toBeLessThan(100); // Should complete quickly
    });
  });

  describe('Memory Management and Performance', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should not leak memory with many operations', async () => {
      const operations = Array.from({ length: 100 }, () =>
        jest.fn().mockResolvedValue('success')
      );
      
      for (const operation of operations) {
        await retryManager.executeWithRetry(operation);
      }
      
      // Should not accumulate internal state
      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(100);
    });

    it('should handle rapid successive operations efficiently', async () => {
      const startTime = Date.now();
      const operations = Array.from({ length: 50 }, () =>
        jest.fn().mockResolvedValue('success')
      );
      
      await Promise.all(operations.map(op => retryManager.executeWithRetry(op)));
      
      const endTime = Date.now();
      
      // All operations should complete quickly (within reasonable time)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle large payload operations', async () => {
      const largeData = 'x'.repeat(1000000); // 1MB string
      const mockOperation = jest.fn().mockResolvedValue(largeData);
      
      const result = await retryManager.executeWithRetry(mockOperation);
      
      expect(result).toBe(largeData);
      expect((result as string).length).toBe(1000000);
    });
  });

  describe('TypeScript Type Safety', () => {
    beforeEach(() => {
      retryManager = new RetryManager(defaultConfig);
    });

    it('should maintain type safety for generic return types', async () => {
      interface TestResult {
        id: number;
        name: string;
      }
      
      const mockOperation = jest.fn().mockResolvedValue({
        id: 123,
        name: 'test'
      } as TestResult);
      
      const result: TestResult = await retryManager.executeWithRetry(mockOperation);
      
      expect(result.id).toBe(123);
      expect(result.name).toBe('test');
    });

    it('should handle async operations with proper typing', async () => {
      const asyncOperation = async (): Promise<string> => {
        await new Promise(resolve => setTimeout(resolve, 0));
        return 'async result';
      };
      
      const result: string = await retryManager.executeWithRetry(asyncOperation);
      
      expect(result).toBe('async result');
    });

    it('should maintain type safety for error callbacks', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Test error'))
        .mockResolvedValue('success');
      
      const retryCallback = jest.fn((attempt: number, error: Error) => {
        expect(typeof attempt).toBe('number');
        expect(error).toBeInstanceOf(Error);
      });
      
      const promise = retryManager.executeWithCallback(mockOperation, retryCallback);
      
      jest.advanceTimersByTime(1000);
      await promise;
      
      expect(retryCallback).toHaveBeenCalled();
    });

    it('should return properly typed configuration', () => {
      const config: RetryConfig = retryManager.getConfig();
      
      expect(typeof config.maxAttempts).toBe('number');
      expect(typeof config.delay).toBe('number');
      expect(typeof config.exponentialBase).toBe('number');
      expect(typeof config.jitter).toBe('boolean');
    });

    it('should return properly typed statistics', () => {
      const stats: RetryStats = retryManager.getStats();
      
      expect(typeof stats.totalAttempts).toBe('number');
      expect(typeof stats.successfulRetries).toBe('number');
      expect(typeof stats.failedRetries).toBe('number');
      expect(typeof stats.averageAttempts).toBe('number');
    });
  });
});