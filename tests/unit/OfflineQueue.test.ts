import { OfflineQueue } from '../../src/services/OfflineQueue';
import { ErrorData } from '../../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('OfflineQueue', () => {
  let offlineQueue: OfflineQueue;
  let mockErrorData: ErrorData;
  let mockOnError: jest.Mock;
  let mockOnWarning: jest.Mock;
  const testQueueFile = path.join(os.tmpdir(), 'test-queue.json');

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false);

    mockOnError = jest.fn();
    mockOnWarning = jest.fn();

    offlineQueue = new OfflineQueue({
      maxQueueSize: 5,
      maxRetries: 2,
      queueFile: testQueueFile,
      onError: mockOnError,
      onWarning: mockOnWarning,
    });

    mockErrorData = {
      message: 'Test error',
      exception_class: 'Error',
      stack_trace: 'Error: Test error',
      file: 'test.js',
      line: 10,
      project: 'test-project',
      environment: 'test',
      timestamp: '2023-01-01T00:00:00.000Z',
    };
  });

  describe('enqueue', () => {
    it('should add error to queue', () => {
      offlineQueue.enqueue(mockErrorData);
      expect(offlineQueue.getQueueSize()).toBe(1);
    });

    it('should respect max queue size', () => {
      // Add 6 items to a queue with max size 5
      for (let i = 0; i < 6; i++) {
        offlineQueue.enqueue({ ...mockErrorData, message: `Error ${i}` });
      }

      expect(offlineQueue.getQueueSize()).toBe(5);
    });

    it('should save queue to file', () => {
      mockedFs.mkdirSync.mockImplementation();
      mockedFs.writeFileSync.mockImplementation();

      offlineQueue.enqueue(mockErrorData);

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        testQueueFile,
        expect.stringContaining(mockErrorData.message)
      );
    });
  });

  describe('processQueue', () => {
    it('should process all items successfully', async () => {
      const mockSender = jest.fn().mockResolvedValue(undefined);

      // Add 3 items
      for (let i = 0; i < 3; i++) {
        offlineQueue.enqueue({ ...mockErrorData, message: `Error ${i}` });
      }

      await offlineQueue.processQueue(mockSender);

      expect(mockSender).toHaveBeenCalledTimes(3);
      expect(offlineQueue.getQueueSize()).toBe(0);
    });

    it('should retry failed items', async () => {
      const mockSender = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(undefined);

      offlineQueue.enqueue(mockErrorData);

      // First process attempt - should fail and retry
      await offlineQueue.processQueue(mockSender);
      expect(offlineQueue.getQueueSize()).toBe(1); // Still in queue

      // Second process attempt - should succeed
      await offlineQueue.processQueue(mockSender);
      expect(offlineQueue.getQueueSize()).toBe(0); // Removed from queue

      expect(mockSender).toHaveBeenCalledTimes(2);
    });

    it('should drop items after max retries', async () => {
      const mockSender = jest.fn().mockRejectedValue(new Error('Persistent error'));

      offlineQueue.enqueue(mockErrorData);

      // Process 2 times (max retries = 2, so 2nd time should drop)
      await offlineQueue.processQueue(mockSender);
      await offlineQueue.processQueue(mockSender);

      expect(offlineQueue.getQueueSize()).toBe(0); // Item dropped
      expect(mockSender).toHaveBeenCalledTimes(2);
    });

    it('should not process when already processing', async () => {
      const mockSender = jest
        .fn()
        .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

      offlineQueue.enqueue(mockErrorData);

      // Start processing (don't await)
      const promise1 = offlineQueue.processQueue(mockSender);

      // Try to process again immediately
      await offlineQueue.processQueue(mockSender);

      // Wait for first processing to complete
      await promise1;

      // Should only have been called once
      expect(mockSender).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearQueue', () => {
    it('should remove all items', () => {
      offlineQueue.enqueue(mockErrorData);
      offlineQueue.enqueue(mockErrorData);

      expect(offlineQueue.getQueueSize()).toBe(2);

      offlineQueue.clearQueue();

      expect(offlineQueue.getQueueSize()).toBe(0);
    });
  });

  describe('file operations', () => {
    it('should load existing queue from file', () => {
      const existingQueue = [
        {
          id: 'test-1',
          data: mockErrorData,
          timestamp: Date.now(),
          attempts: 0,
        },
      ];

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingQueue));

      const newQueue = new OfflineQueue({
        queueFile: testQueueFile,
        onError: mockOnError,
        onWarning: mockOnWarning,
      });

      expect(newQueue.getQueueSize()).toBe(1);
    });

    it('should handle corrupted queue file gracefully', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('invalid json');

      const newQueue = new OfflineQueue({
        queueFile: testQueueFile,
        onError: mockOnError,
        onWarning: mockOnWarning,
      });

      expect(newQueue.getQueueSize()).toBe(0);
    });

    it('should clean up old queue items on load', () => {
      const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      const recentTimestamp = Date.now() - 1 * 60 * 60 * 1000; // 1 hour ago

      const existingQueue = [
        {
          id: 'old-item',
          data: mockErrorData,
          timestamp: oldTimestamp,
          attempts: 0,
        },
        {
          id: 'recent-item',
          data: mockErrorData,
          timestamp: recentTimestamp,
          attempts: 0,
        },
      ];

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingQueue));

      const newQueue = new OfflineQueue({
        queueFile: testQueueFile,
        onError: mockOnError,
        onWarning: mockOnWarning,
      });

      expect(newQueue.getQueueSize()).toBe(1); // Only recent item
    });
  });

  describe('error callbacks', () => {
    it('should call onWarning when dropping errors after max retries', async () => {
      const sender = jest.fn().mockRejectedValue(new Error('Persistent error'));

      offlineQueue.enqueue(mockErrorData);
      
      // First attempt
      await offlineQueue.processQueue(sender);
      // Second attempt  
      await offlineQueue.processQueue(sender);

      expect(mockOnWarning).toHaveBeenCalledWith(
        'Dropping error after 2 failed attempts',
        expect.objectContaining({
          error: expect.any(Error),
          queuedError: expect.any(Object)
        })
      );
    });

    it('should call onWarning when failing to load queue file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('invalid json');

      new OfflineQueue({
        queueFile: testQueueFile,
        onError: mockOnError,
        onWarning: mockOnWarning,
      });

      expect(mockOnWarning).toHaveBeenCalledWith(
        'Failed to load queue file',
        expect.objectContaining({
          error: expect.any(Error)
        })
      );
    });

    it('should use default console callbacks when none provided', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('invalid json');

      new OfflineQueue({
        queueFile: testQueueFile,
      });

      expect(consoleSpy).toHaveBeenCalledWith('ErrorExplorer:', 'Failed to load queue file');
      
      consoleSpy.mockRestore();
    });
  });
});
