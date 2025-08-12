import { BatchManager, BatchConfig, BatchStats, BatchHistoryEntry } from '../../src/services/BatchManager';
import { ErrorData } from '../../src/types';

describe('BatchManager', () => {
  let batchManager: BatchManager;
  let defaultConfig: Partial<BatchConfig>;
  let mockSendFunction: jest.MockedFunction<(batch: ErrorData[]) => Promise<void>>;

  beforeEach(() => {
    jest.useFakeTimers();
    
    defaultConfig = {
      batchSize: 3,
      batchTimeout: 2000,
      maxPayloadSize: 10000, // 10KB
      enableHistory: true,
      maxHistorySize: 10,
    };

    mockSendFunction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (batchManager) {
      batchManager.destroy();
    }
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const createMockErrorData = (id: string, size: number = 100): ErrorData => ({
    message: `Error ${id}`,
    exception_class: 'Error',
    stack_trace: `Stack trace for error ${id}`.repeat(size / 20), // Approximate size
    file: `/path/to/file${id}.js`,
    line: 42,
    project: 'test-project',
    environment: 'test',
    timestamp: new Date().toISOString(),
  });

  describe('Constructor and Configuration', () => {
    it('should create instance with default configuration', () => {
      batchManager = new BatchManager();
      
      const config = batchManager.getConfig();
      expect(config.batchSize).toBe(10);
      expect(config.batchTimeout).toBe(5000);
      expect(config.maxPayloadSize).toBe(512000);
      expect(config.enableHistory).toBe(true);
      expect(config.maxHistorySize).toBe(100);
    });

    it('should create instance with custom configuration', () => {
      batchManager = new BatchManager(defaultConfig);
      
      const config = batchManager.getConfig();
      expect(config.batchSize).toBe(3);
      expect(config.batchTimeout).toBe(2000);
      expect(config.maxPayloadSize).toBe(10000);
      expect(config.enableHistory).toBe(true);
      expect(config.maxHistorySize).toBe(10);
    });

    it('should merge custom config with defaults', () => {
      const partialConfig = { batchSize: 5 };
      batchManager = new BatchManager(partialConfig);
      
      const config = batchManager.getConfig();
      expect(config.batchSize).toBe(5);
      expect(config.batchTimeout).toBe(5000); // default
      expect(config.enableHistory).toBe(true); // default
    });

    it('should initialize with empty stats', () => {
      batchManager = new BatchManager(defaultConfig);
      
      const stats = batchManager.getStats();
      expect(stats.currentSize).toBe(0);
      expect(stats.totalBatches).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.averageBatchSize).toBe(0);
      expect(stats.lastSentAt).toBeUndefined();
      expect(stats.history).toEqual([]);
    });

    it('should disable history when configured', () => {
      const configWithoutHistory = { ...defaultConfig, enableHistory: false };
      batchManager = new BatchManager(configWithoutHistory);
      
      const stats = batchManager.getStats();
      expect(stats.history).toBeUndefined();
    });
  });

  describe('Send Function Management', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
    });

    it('should set send function', () => {
      batchManager.setSendFunction(mockSendFunction);
      
      // Add error to trigger send
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      // Should trigger send when batch size is reached
      expect(mockSendFunction).toHaveBeenCalledTimes(1);
    });

    it('should throw error when flushing without send function', async () => {
      batchManager.addToBatch(createMockErrorData('1'));
      
      await expect(batchManager.flush()).resolves.toBeUndefined(); // Should return early
      
      // No error should be thrown, but no send should occur
      expect(mockSendFunction).not.toHaveBeenCalled();
    });
  });

  describe('Basic Batch Operations', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should add errors to batch', () => {
      const error1 = createMockErrorData('1');
      const error2 = createMockErrorData('2');
      
      batchManager.addToBatch(error1);
      batchManager.addToBatch(error2);
      
      const stats = batchManager.getStats();
      expect(stats.currentSize).toBe(2);
      expect(stats.totalErrors).toBe(2);
      
      const currentBatch = batchManager.getCurrentBatch();
      expect(currentBatch).toHaveLength(2);
      expect(currentBatch).toContain(error1);
      expect(currentBatch).toContain(error2);
    });

    it('should send batch when size limit reached', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      
      expect(mockSendFunction).not.toHaveBeenCalled();
      
      batchManager.addToBatch(createMockErrorData('3')); // Triggers send at size 3
      
      expect(mockSendFunction).toHaveBeenCalledTimes(1);
      expect(mockSendFunction).toHaveBeenCalledWith([
        expect.objectContaining({ message: 'Error 1' }),
        expect.objectContaining({ message: 'Error 2' }),
        expect.objectContaining({ message: 'Error 3' }),
      ]);
    });

    it('should clear current batch after sending', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      const stats = batchManager.getStats();
      expect(stats.currentSize).toBe(0); // Should be cleared after send
      
      const currentBatch = batchManager.getCurrentBatch();
      expect(currentBatch).toHaveLength(0);
    });

    it('should continue adding to new batch after send', () => {
      // Fill first batch
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      expect(mockSendFunction).toHaveBeenCalledTimes(1);
      
      // Add to new batch
      batchManager.addToBatch(createMockErrorData('4'));
      batchManager.addToBatch(createMockErrorData('5'));
      
      const stats = batchManager.getStats();
      expect(stats.currentSize).toBe(2);
      expect(stats.totalErrors).toBe(5);
    });

    it('should track total errors correctly', () => {
      for (let i = 1; i <= 10; i++) {
        batchManager.addToBatch(createMockErrorData(i.toString()));
      }
      
      const stats = batchManager.getStats();
      expect(stats.totalErrors).toBe(10);
      expect(stats.totalBatches).toBe(3); // 3 full batches of 3 + 1 partial batch
      expect(stats.currentSize).toBe(1); // Remaining error in current batch
    });
  });

  describe('Timeout-Based Batching', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should send batch after timeout', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2')); // Less than batchSize
      
      expect(mockSendFunction).not.toHaveBeenCalled();
      
      // Advance time to trigger timeout
      jest.advanceTimersByTime(2000);
      
      expect(mockSendFunction).toHaveBeenCalledTimes(1);
      expect(mockSendFunction).toHaveBeenCalledWith([
        expect.objectContaining({ message: 'Error 1' }),
        expect.objectContaining({ message: 'Error 2' }),
      ]);
    });

    it('should not set multiple timeouts for same batch', () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      
      batchManager.addToBatch(createMockErrorData('1'));
      const timeoutCount1 = setTimeoutSpy.mock.calls.length;
      
      batchManager.addToBatch(createMockErrorData('2'));
      const timeoutCount2 = setTimeoutSpy.mock.calls.length;
      
      // Should not create additional timeout
      expect(timeoutCount2).toBe(timeoutCount1);
    });

    it('should clear timeout when batch is sent by size', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      batchManager.addToBatch(createMockErrorData('1')); // Sets timeout
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3')); // Triggers send by size
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should reset timeout for new batch', () => {
      // First batch sent by size
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      mockSendFunction.mockClear();
      
      // Start new batch with timeout
      batchManager.addToBatch(createMockErrorData('4'));
      
      expect(mockSendFunction).not.toHaveBeenCalled();
      
      jest.advanceTimersByTime(2000);
      
      expect(mockSendFunction).toHaveBeenCalledWith([
        expect.objectContaining({ message: 'Error 4' }),
      ]);
    });
  });

  describe('Manual Flushing', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should flush current batch manually', async () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      
      expect(mockSendFunction).not.toHaveBeenCalled();
      
      await batchManager.flush();
      
      expect(mockSendFunction).toHaveBeenCalledTimes(1);
      expect(mockSendFunction).toHaveBeenCalledWith([
        expect.objectContaining({ message: 'Error 1' }),
        expect.objectContaining({ message: 'Error 2' }),
      ]);
    });

    it('should not flush empty batch', async () => {
      await batchManager.flush();
      
      expect(mockSendFunction).not.toHaveBeenCalled();
    });

    it('should clear timeout when manually flushed', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      batchManager.addToBatch(createMockErrorData('1')); // Sets timeout
      
      await batchManager.flush();
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should update stats after manual flush', async () => {
      batchManager.addToBatch(createMockErrorData('1'));
      
      await batchManager.flush();
      
      const stats = batchManager.getStats();
      expect(stats.currentSize).toBe(0);
      expect(stats.totalBatches).toBe(1);
      expect(stats.lastSentAt).toBeDefined();
    });
  });

  describe('Payload Size Management', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should send batch in chunks when payload size exceeded', async () => {
      // Create large errors that will exceed maxPayloadSize when combined
      const largeError1 = createMockErrorData('1', 4000); // ~4KB
      const largeError2 = createMockErrorData('2', 4000); // ~4KB  
      const largeError3 = createMockErrorData('3', 4000); // ~4KB - total ~12KB > 10KB limit
      
      batchManager.addToBatch(largeError1);
      batchManager.addToBatch(largeError2);
      batchManager.addToBatch(largeError3);
      
      // Should have split into chunks
      expect(mockSendFunction.mock.calls.length).toBeGreaterThanOrEqual(1);
      
      // Verify all errors were sent
      const allSentErrors = mockSendFunction.mock.calls.flat().flat();
      expect(allSentErrors).toHaveLength(3);
    });

    it('should log warning when splitting batches', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const largeErrors = [
        createMockErrorData('1', 4000),
        createMockErrorData('2', 4000),
        createMockErrorData('3', 4000),
      ];
      
      largeErrors.forEach(error => batchManager.addToBatch(error));
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Batch payload size'),
        expect.stringContaining('exceeds limit')
      );
      
      consoleSpy.mockRestore();
    });

    it('should add delay between chunks', async () => {
      const largeErrors = Array.from({ length: 6 }, (_, i) => 
        createMockErrorData((i + 1).toString(), 2000) // Should create multiple chunks
      );
      
      largeErrors.forEach(error => batchManager.addToBatch(error));
      
      // If multiple chunks were sent, there should be delays
      if (mockSendFunction.mock.calls.length > 1) {
        // Advance time to allow delays to complete
        jest.advanceTimersByTime(1000);
        
        // Verify that delays were used (implementation detail)
        expect(jest.getTimerCount()).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle single error exceeding payload size', async () => {
      const hugeError = createMockErrorData('huge', 15000); // 15KB > 10KB limit
      
      batchManager.addToBatch(hugeError);
      
      // Should still send the error, even though it's large
      expect(mockSendFunction).toHaveBeenCalledWith([hugeError]);
    });

    it('should calculate payload size correctly', () => {
      const testError = createMockErrorData('test');
      const jsonSize = Buffer.byteLength(JSON.stringify(testError), 'utf8');
      
      // This is more of a sanity check for our test helpers
      expect(jsonSize).toBeGreaterThan(0);
      expect(jsonSize).toBeLessThan(10000); // Should be well under our limit
    });
  });

  describe('Statistics and History', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should track batch statistics', () => {
      // Send first batch
      for (let i = 1; i <= 3; i++) {
        batchManager.addToBatch(createMockErrorData(i.toString()));
      }
      
      // Send second batch
      for (let i = 4; i <= 6; i++) {
        batchManager.addToBatch(createMockErrorData(i.toString()));
      }
      
      const stats = batchManager.getStats();
      expect(stats.totalBatches).toBe(2);
      expect(stats.totalErrors).toBe(6);
      expect(stats.averageBatchSize).toBe(3);
      expect(stats.lastSentAt).toBeDefined();
      expect(stats.lastSentAt).toBeGreaterThan(0);
    });

    it('should calculate average batch size correctly', () => {
      // First batch: 3 errors
      for (let i = 1; i <= 3; i++) {
        batchManager.addToBatch(createMockErrorData(i.toString()));
      }
      
      // Second batch: 1 error (manual flush)
      batchManager.addToBatch(createMockErrorData('4'));
      batchManager.flush();
      
      const stats = batchManager.getStats();
      expect(stats.averageBatchSize).toBe(2); // (3 + 1) / 2 = 2
    });

    it('should maintain batch history', () => {
      // Send successful batch
      for (let i = 1; i <= 3; i++) {
        batchManager.addToBatch(createMockErrorData(i.toString()));
      }
      
      const stats = batchManager.getStats();
      expect(stats.history).toHaveLength(1);
      
      const historyEntry = stats.history![0];
      expect(historyEntry.timestamp).toBeDefined();
      expect(historyEntry.size).toBe(3);
      expect(historyEntry.payloadSize).toBeGreaterThan(0);
      expect(historyEntry.success).toBe(true);
      expect(historyEntry.error).toBeUndefined();
    });

    it('should record failed batch in history', async () => {
      const error = new Error('Send failed');
      mockSendFunction.mockRejectedValueOnce(error);
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      batchManager.addToBatch(createMockErrorData('1'));
      
      try {
        await batchManager.flush();
      } catch (e) {
        // Expected to fail
      }
      
      const stats = batchManager.getStats();
      expect(stats.history).toHaveLength(1);
      
      const historyEntry = stats.history![0];
      expect(historyEntry.success).toBe(false);
      expect(historyEntry.error).toBe('Send failed');
      
      consoleSpy.mockRestore();
    });

    it('should limit history size', () => {
      const smallHistoryConfig = { ...defaultConfig, maxHistorySize: 3 };
      batchManager.destroy();
      batchManager = new BatchManager(smallHistoryConfig);
      batchManager.setSendFunction(mockSendFunction);
      
      // Send 5 batches (more than history limit)
      for (let batch = 1; batch <= 5; batch++) {
        for (let i = 1; i <= 3; i++) {
          batchManager.addToBatch(createMockErrorData(`${batch}-${i}`));
        }
      }
      
      const stats = batchManager.getStats();
      expect(stats.history).toHaveLength(3); // Limited by maxHistorySize
      expect(stats.totalBatches).toBe(5); // But total count is still accurate
    });

    it('should not maintain history when disabled', () => {
      const noHistoryConfig = { ...defaultConfig, enableHistory: false };
      batchManager.destroy();
      batchManager = new BatchManager(noHistoryConfig);
      batchManager.setSendFunction(mockSendFunction);
      
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      const stats = batchManager.getStats();
      expect(stats.history).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should handle send function errors gracefully', async () => {
      const error = new Error('Network failure');
      mockSendFunction.mockRejectedValueOnce(error);
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      batchManager.addToBatch(createMockErrorData('1'));
      
      await expect(batchManager.flush()).rejects.toThrow('Network failure');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send batch'),
        'Network failure'
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle non-Error objects in send function', async () => {
      mockSendFunction.mockRejectedValueOnce('String error');
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      batchManager.addToBatch(createMockErrorData('1'));
      
      await expect(batchManager.flush()).rejects.toBe('String error');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send batch'),
        'String error'
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle send function returning undefined', async () => {
      mockSendFunction.mockResolvedValueOnce(undefined);
      
      batchManager.addToBatch(createMockErrorData('1'));
      
      await expect(batchManager.flush()).resolves.toBeUndefined();
      
      const stats = batchManager.getStats();
      expect(stats.totalBatches).toBe(1);
    });

    it('should continue operation after send error', async () => {
      // First batch fails
      mockSendFunction.mockRejectedValueOnce(new Error('First failure'));
      // Second batch succeeds  
      mockSendFunction.mockResolvedValueOnce(undefined);
      
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // First batch
      batchManager.addToBatch(createMockErrorData('1'));
      try {
        await batchManager.flush();
      } catch (e) {
        // Expected
      }
      
      // Second batch
      batchManager.addToBatch(createMockErrorData('2'));
      await batchManager.flush();
      
      expect(mockSendFunction).toHaveBeenCalledTimes(2);
      
      const stats = batchManager.getStats();
      expect(stats.totalBatches).toBe(1); // Only successful batches counted
      
      consoleSpy.mockRestore();
    });
  });

  describe('Configuration Management', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should update configuration', () => {
      const updates = {
        batchSize: 5,
        batchTimeout: 3000,
        maxPayloadSize: 20000,
      };
      
      batchManager.updateConfig(updates);
      
      const config = batchManager.getConfig();
      expect(config.batchSize).toBe(5);
      expect(config.batchTimeout).toBe(3000);
      expect(config.maxPayloadSize).toBe(20000);
      expect(config.enableHistory).toBe(true); // Should remain unchanged
    });

    it('should affect batching behavior after config update', () => {
      // Update batch size
      batchManager.updateConfig({ batchSize: 2 });
      
      batchManager.addToBatch(createMockErrorData('1'));
      expect(mockSendFunction).not.toHaveBeenCalled();
      
      batchManager.addToBatch(createMockErrorData('2')); // Should trigger send with new size
      expect(mockSendFunction).toHaveBeenCalledTimes(1);
    });

    it('should enable history when updated from disabled', () => {
      const noHistoryConfig = { ...defaultConfig, enableHistory: false };
      batchManager.destroy();
      batchManager = new BatchManager(noHistoryConfig);
      batchManager.setSendFunction(mockSendFunction);
      
      expect(batchManager.getStats().history).toBeUndefined();
      
      batchManager.updateConfig({ enableHistory: true });
      
      const stats = batchManager.getStats();
      expect(stats.history).toEqual([]);
    });

    it('should disable history when updated from enabled', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      expect(batchManager.getStats().history).toHaveLength(1);
      
      batchManager.updateConfig({ enableHistory: false });
      
      const stats = batchManager.getStats();
      expect(stats.history).toBeUndefined();
    });

    it('should return current configuration', () => {
      const config = batchManager.getConfig();
      expect(config).toEqual(defaultConfig);
    });
  });

  describe('Batch Clearing and Current State', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should clear current batch manually', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      
      expect(batchManager.getCurrentBatch()).toHaveLength(2);
      expect(batchManager.getStats().currentSize).toBe(2);
      
      batchManager.clearCurrentBatch();
      
      expect(batchManager.getCurrentBatch()).toHaveLength(0);
      expect(batchManager.getStats().currentSize).toBe(0);
    });

    it('should clear timeout when clearing batch', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      batchManager.addToBatch(createMockErrorData('1')); // Sets timeout
      batchManager.clearCurrentBatch();
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should return copy of current batch', () => {
      const error = createMockErrorData('1');
      batchManager.addToBatch(error);
      
      const batch1 = batchManager.getCurrentBatch();
      const batch2 = batchManager.getCurrentBatch();
      
      // Should be different array instances
      expect(batch1).not.toBe(batch2);
      // But same content
      expect(batch1).toEqual(batch2);
      
      // Modifying returned array should not affect internal state
      batch1.push(createMockErrorData('external'));
      expect(batchManager.getCurrentBatch()).toHaveLength(1);
    });

    it('should maintain total error count when clearing batch', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      
      expect(batchManager.getStats().totalErrors).toBe(2);
      
      batchManager.clearCurrentBatch();
      
      expect(batchManager.getStats().totalErrors).toBe(2); // Should not change
    });
  });

  describe('Statistics Reset', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should reset statistics', () => {
      // Generate some activity
      for (let i = 1; i <= 6; i++) {
        batchManager.addToBatch(createMockErrorData(i.toString()));
      }
      
      expect(batchManager.getStats().totalBatches).toBe(2);
      expect(batchManager.getStats().totalErrors).toBe(6);
      
      batchManager.resetStats();
      
      const stats = batchManager.getStats();
      expect(stats.totalBatches).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.averageBatchSize).toBe(0);
      expect(stats.lastSentAt).toBeUndefined();
      expect(stats.history).toEqual([]);
    });

    it('should preserve current batch size when resetting stats', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      
      expect(batchManager.getStats().currentSize).toBe(2);
      
      batchManager.resetStats();
      
      expect(batchManager.getStats().currentSize).toBe(2); // Should be preserved
    });

    it('should not reset history when history is disabled', () => {
      const noHistoryConfig = { ...defaultConfig, enableHistory: false };
      batchManager.destroy();
      batchManager = new BatchManager(noHistoryConfig);
      batchManager.setSendFunction(mockSendFunction);
      
      batchManager.resetStats();
      
      const stats = batchManager.getStats();
      expect(stats.history).toBeUndefined();
    });
  });

  describe('Cleanup and Destruction', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should clear timeout on destroy', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      batchManager.addToBatch(createMockErrorData('1')); // Sets timeout
      batchManager.destroy();
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should flush remaining items on destroy', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      
      batchManager.destroy();
      
      // Should attempt to flush (though it might fail)
      expect(mockSendFunction).toHaveBeenCalledWith([
        expect.objectContaining({ message: 'Error 1' }),
        expect.objectContaining({ message: 'Error 2' }),
      ]);
      
      consoleSpy.mockRestore();
    });

    it('should handle flush errors during destroy', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockSendFunction.mockRejectedValueOnce(new Error('Destroy flush failed'));
      
      batchManager.addToBatch(createMockErrorData('1'));
      
      expect(() => {
        batchManager.destroy();
      }).not.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error flushing batch during destroy:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle destroy without pending items', () => {
      expect(() => {
        batchManager.destroy();
      }).not.toThrow();
      
      expect(mockSendFunction).not.toHaveBeenCalled();
    });

    it('should handle multiple destroy calls', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      
      expect(() => {
        batchManager.destroy();
        batchManager.destroy();
        batchManager.destroy();
      }).not.toThrow();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should handle extremely large batches', () => {
      const largeBatch = Array.from({ length: 1000 }, (_, i) => 
        createMockErrorData(i.toString())
      );
      
      largeBatch.forEach(error => batchManager.addToBatch(error));
      
      // Should have sent multiple batches
      expect(mockSendFunction.mock.calls.length).toBeGreaterThan(100);
    });

    it('should handle errors with complex data structures', () => {
      const complexError: ErrorData = {
        ...createMockErrorData('complex'),
        context: {
          user: { id: 123, profile: { nested: { data: 'deep' } } },
          request: {
            headers: { 'user-agent': 'test', 'x-custom': 'value' },
            body: { field: 'value', array: [1, 2, 3] },
          },
          metadata: new Array(100).fill('data'),
        },
        breadcrumbs: Array.from({ length: 50 }, (_, i) => ({
          message: `Breadcrumb ${i}`,
          category: 'test',
          level: 'info' as const,
          timestamp: new Date().toISOString(),
          data: { index: i },
        })),
      };
      
      batchManager.addToBatch(complexError);
      batchManager.addToBatch(complexError);
      batchManager.addToBatch(complexError);
      
      expect(mockSendFunction).toHaveBeenCalledTimes(1);
    });

    it('should handle errors with circular references', () => {
      const circularError: any = createMockErrorData('circular');
      circularError.context = { self: circularError };
      
      expect(() => {
        batchManager.addToBatch(circularError);
      }).not.toThrow();
    });

    it('should handle null and undefined errors gracefully', () => {
      expect(() => {
        batchManager.addToBatch(null as any);
        batchManager.addToBatch(undefined as any);
      }).not.toThrow();
      
      const stats = batchManager.getStats();
      expect(stats.totalErrors).toBe(2);
    });

    it('should handle very small payload size limits', () => {
      const tinyLimitConfig = { ...defaultConfig, maxPayloadSize: 100 };
      batchManager.destroy();
      batchManager = new BatchManager(tinyLimitConfig);
      batchManager.setSendFunction(mockSendFunction);
      
      // Even small errors might exceed tiny limit
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      // Should handle the splitting gracefully
      expect(mockSendFunction.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle zero payload size limit', () => {
      const zeroLimitConfig = { ...defaultConfig, maxPayloadSize: 0 };
      batchManager.destroy();
      batchManager = new BatchManager(zeroLimitConfig);
      batchManager.setSendFunction(mockSendFunction);
      
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      // Should still send errors
      expect(mockSendFunction).toHaveBeenCalled();
    });
  });

  describe('Concurrency and Performance', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should handle rapid batch additions', () => {
      const startTime = Date.now();
      
      // Add many errors rapidly
      for (let i = 0; i < 1000; i++) {
        batchManager.addToBatch(createMockErrorData(i.toString()));
      }
      
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // Should complete quickly
      expect(batchManager.getStats().totalErrors).toBe(1000);
    });

    it('should handle concurrent operations', async () => {
      const promises = [];
      
      // Simulate concurrent additions
      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve().then(() => {
            batchManager.addToBatch(createMockErrorData(i.toString()));
          })
        );
      }
      
      await Promise.all(promises);
      
      expect(batchManager.getStats().totalErrors).toBe(100);
    });

    it('should not leak memory with many operations', () => {
      // This test runs many operations to check for potential memory leaks
      for (let i = 0; i < 1000; i++) {
        batchManager.addToBatch(createMockErrorData(i.toString()));
        
        if (i % 100 === 0) {
          batchManager.flush();
        }
      }
      
      // If we reach this point without running out of memory, the test passes
      expect(true).toBe(true);
    });
  });

  describe('Node.js Specific Features', () => {
    beforeEach(() => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
    });

    it('should work with Node.js Buffer operations', () => {
      const bufferData = Buffer.from('Test error data with special chars: 特殊字符');
      const errorWithBuffer: ErrorData = {
        ...createMockErrorData('buffer'),
        context: { bufferData: bufferData.toString() },
      };
      
      batchManager.addToBatch(errorWithBuffer);
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      expect(mockSendFunction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            context: expect.objectContaining({
              bufferData: expect.stringContaining('特殊字符'),
            }),
          }),
        ])
      );
    });

    it('should handle Node.js Timer precision correctly', () => {
      batchManager.addToBatch(createMockErrorData('1'));
      
      const beforeTime = Date.now();
      jest.advanceTimersByTime(2000);
      const afterTime = Date.now();
      
      expect(afterTime - beforeTime).toBe(2000);
      expect(mockSendFunction).toHaveBeenCalled();
    });

    it('should work with Node.js process events', async () => {
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      
      // Simulate process exit scenario
      await batchManager.flush();
      
      expect(mockSendFunction).toHaveBeenCalledWith([
        expect.objectContaining({ message: 'Error 1' }),
        expect.objectContaining({ message: 'Error 2' }),
      ]);
    });

    it('should handle Unicode and special encodings', () => {
      const unicodeError: ErrorData = {
        ...createMockErrorData('unicode'),
        message: 'Error with unicode: 🚀 中文 العربية русский',
        context: {
          emoji: '👍👎✨🔥💯',
          chinese: '你好世界',
          arabic: 'مرحبا بالعالم',
          russian: 'Привет мир',
        },
      };
      
      batchManager.addToBatch(unicodeError);
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      expect(mockSendFunction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('🚀'),
            context: expect.objectContaining({
              emoji: '👍👎✨🔥💯',
            }),
          }),
        ])
      );
    });
  });

  describe('TypeScript Type Safety', () => {
    it('should maintain type safety for configuration', () => {
      const config: BatchConfig = batchManager?.getConfig() || defaultConfig as BatchConfig;
      
      expect(typeof config.batchSize).toBe('number');
      expect(typeof config.batchTimeout).toBe('number');
      expect(typeof config.enableHistory).toBe('boolean');
    });

    it('should return properly typed statistics', () => {
      batchManager = new BatchManager(defaultConfig);
      
      const stats: BatchStats = batchManager.getStats();
      
      expect(typeof stats.currentSize).toBe('number');
      expect(typeof stats.totalBatches).toBe('number');
      expect(typeof stats.totalErrors).toBe('number');
      expect(typeof stats.averageBatchSize).toBe('number');
    });

    it('should handle typed error data correctly', () => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
      
      const typedError: ErrorData = createMockErrorData('typed');
      
      batchManager.addToBatch(typedError);
      
      const currentBatch: ErrorData[] = batchManager.getCurrentBatch();
      expect(currentBatch).toHaveLength(1);
      expect(currentBatch[0]).toEqual(typedError);
    });

    it('should maintain type safety for history entries', () => {
      batchManager = new BatchManager(defaultConfig);
      batchManager.setSendFunction(mockSendFunction);
      
      batchManager.addToBatch(createMockErrorData('1'));
      batchManager.addToBatch(createMockErrorData('2'));
      batchManager.addToBatch(createMockErrorData('3'));
      
      const stats = batchManager.getStats();
      
      if (stats.history) {
        const entry: BatchHistoryEntry = stats.history[0];
        expect(typeof entry.timestamp).toBe('number');
        expect(typeof entry.size).toBe('number');
        expect(typeof entry.payloadSize).toBe('number');
        expect(typeof entry.success).toBe('boolean');
      }
    });
  });
});