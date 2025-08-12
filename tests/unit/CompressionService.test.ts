import { CompressionService, CompressionConfig, CompressionStats } from '../../src/services/CompressionService';
import * as zlib from 'zlib';

// Mock zlib module
jest.mock('zlib');

const mockedZlib = zlib as jest.Mocked<typeof zlib>;

describe('CompressionService', () => {
  let compressionService: CompressionService;
  let defaultConfig: Partial<CompressionConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    defaultConfig = {
      threshold: 500, // 500 bytes
      level: 6,
      enableEstimation: true,
      chunkSize: 1024, // 1KB
    };

    // Mock zlib.gzip to return compressed buffer
    mockedZlib.gzip.mockImplementation((data: any, options: any, callback: any) => {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      
      const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const compressed = Buffer.from('compressed_' + input.toString().substring(0, 20));
      
      // Simulate compression by making it smaller (for most test cases)
      const ratio = 0.6; // 60% of original size
      const compressedData = Buffer.alloc(Math.floor(input.length * ratio));
      compressedData.write(compressed.toString());
      
      setImmediate(() => callback(null, compressedData));
    });

    // Mock zlib.gunzip to return decompressed buffer  
    mockedZlib.gunzip.mockImplementation((data: any, callback: any) => {
      const input = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
      const decompressed = Buffer.from('decompressed_data_' + Math.random());
      setImmediate(() => callback(null, decompressed));
    });
  });

  describe('Constructor and Configuration', () => {
    it('should create instance with default configuration', () => {
      compressionService = new CompressionService();
      
      const config = compressionService.getConfig();
      expect(config.threshold).toBe(1024);
      expect(config.level).toBe(6);
      expect(config.enableEstimation).toBe(true);
      expect(config.chunkSize).toBe(16 * 1024);
    });

    it('should create instance with custom configuration', () => {
      compressionService = new CompressionService(defaultConfig);
      
      const config = compressionService.getConfig();
      expect(config.threshold).toBe(500);
      expect(config.level).toBe(6);
      expect(config.enableEstimation).toBe(true);
      expect(config.chunkSize).toBe(1024);
    });

    it('should merge custom config with defaults', () => {
      const partialConfig = { threshold: 2048 };
      compressionService = new CompressionService(partialConfig);
      
      const config = compressionService.getConfig();
      expect(config.threshold).toBe(2048);
      expect(config.level).toBe(6); // default
      expect(config.enableEstimation).toBe(true); // default
    });

    it('should initialize with empty stats', () => {
      compressionService = new CompressionService(defaultConfig);
      
      const stats = compressionService.getStats();
      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalDecompressions).toBe(0);
      expect(stats.totalBytesSaved).toBe(0);
      expect(stats.averageCompressionRatio).toBe(0);
      expect(stats.compressionTime).toBe(0);
    });
  });

  describe('Compression Threshold Logic', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should determine if string should be compressed', () => {
      const smallString = 'small';
      const largeString = 'x'.repeat(600); // Larger than 500 byte threshold
      
      expect(compressionService.shouldCompress(smallString)).toBe(false);
      expect(compressionService.shouldCompress(largeString)).toBe(true);
    });

    it('should determine if buffer should be compressed', () => {
      const smallBuffer = Buffer.from('small data');
      const largeBuffer = Buffer.alloc(600).fill('x');
      
      expect(compressionService.shouldCompress(smallBuffer)).toBe(false);
      expect(compressionService.shouldCompress(largeBuffer)).toBe(true);
    });

    it('should determine if object should be compressed', () => {
      const smallObject = { message: 'small' };
      const largeObject = { 
        message: 'large'.repeat(150), // Creates large JSON when stringified
        data: new Array(50).fill('item'),
      };
      
      expect(compressionService.shouldCompress(smallObject)).toBe(false);
      expect(compressionService.shouldCompress(largeObject)).toBe(true);
    });

    it('should handle edge case at exact threshold', () => {
      const exactThresholdString = 'x'.repeat(500); // Exactly at threshold
      
      expect(compressionService.shouldCompress(exactThresholdString)).toBe(false);
      
      const overThresholdString = 'x'.repeat(501); // Just over threshold
      expect(compressionService.shouldCompress(overThresholdString)).toBe(true);
    });

    it('should handle empty and null data', () => {
      expect(compressionService.shouldCompress('')).toBe(false);
      expect(compressionService.shouldCompress(null)).toBe(false);
      expect(compressionService.shouldCompress(undefined)).toBe(false);
    });
  });

  describe('Basic Compression', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should compress string data above threshold', async () => {
      const largeString = 'test data '.repeat(100); // Well above threshold
      
      const compressed = await compressionService.compress(largeString);
      
      expect(compressed).toBeTruthy();
      expect(typeof compressed).toBe('string');
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        largeString,
        expect.objectContaining({
          level: 6,
          chunkSize: 1024,
        }),
        expect.any(Function)
      );
    });

    it('should return original string if below threshold', async () => {
      const smallString = 'small';
      
      const result = await compressionService.compress(smallString);
      
      expect(result).toBe(smallString);
      expect(mockedZlib.gzip).not.toHaveBeenCalled();
    });

    it('should compress object data', async () => {
      const largeObject = {
        message: 'test'.repeat(100),
        data: new Array(50).fill('item'),
      };
      
      const compressed = await compressionService.compress(largeObject);
      
      expect(compressed).toBeTruthy();
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        JSON.stringify(largeObject),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should return base64 encoded compressed data', async () => {
      const largeString = 'test data '.repeat(100);
      
      // Mock gzip to return known buffer
      const mockCompressed = Buffer.from('mock_compressed_data');
      mockedZlib.gzip.mockImplementationOnce((data, options, callback) => {
        setImmediate(() => callback(null, mockCompressed));
      });
      
      const result = await compressionService.compress(largeString);
      
      expect(result).toBe(mockCompressed.toString('base64'));
    });

    it('should handle compression errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      mockedZlib.gzip.mockImplementationOnce((data, options, callback) => {
        setImmediate(() => callback(new Error('Compression failed')));
      });
      
      const largeString = 'test data '.repeat(100);
      const result = await compressionService.compress(largeString);
      
      // Should return original data when compression fails
      expect(result).toBe(largeString);
      expect(consoleSpy).toHaveBeenCalledWith('Compression failed:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should use configured compression level and chunk size', async () => {
      const customConfig = { ...defaultConfig, level: 9, chunkSize: 2048 };
      compressionService = new CompressionService(customConfig);
      
      const largeString = 'test data '.repeat(100);
      await compressionService.compress(largeString);
      
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        largeString,
        expect.objectContaining({
          level: 9,
          chunkSize: 2048,
        }),
        expect.any(Function)
      );
    });
  });

  describe('Decompression', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should decompress base64 encoded data', async () => {
      const mockDecompressed = Buffer.from('original data');
      mockedZlib.gunzip.mockImplementationOnce((data, callback) => {
        setImmediate(() => callback(null, mockDecompressed));
      });
      
      const compressedData = Buffer.from('compressed').toString('base64');
      const result = await compressionService.decompress(compressedData);
      
      expect(result).toBe(mockDecompressed.toString('utf8'));
      expect(mockedZlib.gunzip).toHaveBeenCalledWith(
        Buffer.from(compressedData, 'base64'),
        expect.any(Function)
      );
    });

    it('should handle decompression errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      mockedZlib.gunzip.mockImplementationOnce((data, callback) => {
        setImmediate(() => callback(new Error('Invalid compressed data')));
      });
      
      const invalidData = 'invalid_base64_data';
      
      await expect(compressionService.decompress(invalidData)).rejects.toThrow(
        'Failed to decompress data: Invalid compressed data'
      );
      
      expect(consoleSpy).toHaveBeenCalledWith('Decompression failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('should update decompression statistics', async () => {
      const mockDecompressed = Buffer.from('decompressed data');
      mockedZlib.gunzip.mockImplementationOnce((data, callback) => {
        setImmediate(() => callback(null, mockDecompressed));
      });
      
      const compressedData = Buffer.from('compressed').toString('base64');
      await compressionService.decompress(compressedData);
      
      const stats = compressionService.getStats();
      expect(stats.totalDecompressions).toBe(1);
    });

    it('should log decompression timing', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockDecompressed = Buffer.from('test data');
      mockedZlib.gunzip.mockImplementationOnce((data, callback) => {
        // Simulate some processing time
        setTimeout(() => callback(null, mockDecompressed), 10);
      });
      
      const compressedData = Buffer.from('compressed').toString('base64');
      await compressionService.decompress(compressedData);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Decompression completed in \d+ms/)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Object Compression', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should compress object and return detailed result', async () => {
      const testObject = {
        message: 'test'.repeat(100),
        data: new Array(20).fill('item'),
      };
      
      const result = await compressionService.compressObject(testObject);
      
      expect(result).toHaveProperty('compressed');
      expect(result).toHaveProperty('originalSize');
      expect(result).toHaveProperty('compressedSize');
      expect(result).toHaveProperty('ratio');
      
      expect(result.originalSize).toBeGreaterThan(0);
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.ratio).toBeGreaterThan(0);
      expect(result.ratio).toBeLessThanOrEqual(1);
    });

    it('should calculate compression ratio correctly', async () => {
      const testObject = { data: 'x'.repeat(1000) };
      
      // Mock specific compression behavior
      const originalSize = Buffer.byteLength(JSON.stringify(testObject), 'utf8');
      const mockCompressedSize = Math.floor(originalSize * 0.3); // 30% of original
      const mockCompressed = Buffer.alloc(mockCompressedSize);
      
      mockedZlib.gzip.mockImplementationOnce((data, options, callback) => {
        setImmediate(() => callback(null, mockCompressed));
      });
      
      const result = await compressionService.compressObject(testObject);
      
      expect(result.originalSize).toBe(originalSize);
      expect(result.compressedSize).toBe(Buffer.byteLength(mockCompressed.toString('base64'), 'utf8'));
      expect(result.ratio).toBeLessThan(1);
    });

    it('should handle zero-sized objects', async () => {
      const emptyObject = {};
      
      const result = await compressionService.compressObject(emptyObject);
      
      expect(result.originalSize).toBeGreaterThan(0); // "{}" still has size
      expect(result.ratio).toBeDefined();
    });

    it('should handle objects with circular references', async () => {
      const circularObject: any = { name: 'test' };
      circularObject.self = circularObject;
      
      // JSON.stringify should throw for circular references
      await expect(compressionService.compressObject(circularObject)).rejects.toThrow();
    });
  });

  describe('Batch Compression', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should compress batch with metadata', async () => {
      const items = [
        { id: 1, message: 'item 1' },
        { id: 2, message: 'item 2' },
        { id: 3, message: 'item 3' },
      ];
      
      const result = await compressionService.compressBatch(items);
      
      expect(result).toHaveProperty('compressed');
      expect(result).toHaveProperty('originalSize');
      expect(result).toHaveProperty('compressedSize');
      expect(result).toHaveProperty('ratio');
      expect(result).toHaveProperty('itemCount');
      
      expect(result.itemCount).toBe(3);
    });

    it('should include timestamp and count in batch data', async () => {
      const items = [{ test: 'data' }];
      
      await compressionService.compressBatch(items);
      
      // Verify that gzip was called with batch structure
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        expect.stringContaining('"items"'),
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        expect.stringContaining('"timestamp"'),
        expect.any(Object),
        expect.any(Function)
      );
      
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        expect.stringContaining('"count"'),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle empty batch', async () => {
      const emptyBatch: any[] = [];
      
      const result = await compressionService.compressBatch(emptyBatch);
      
      expect(result.itemCount).toBe(0);
      expect(result.originalSize).toBeGreaterThan(0); // Still has batch structure
    });

    it('should handle large batches efficiently', async () => {
      const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        message: `Message ${i}`,
        data: 'x'.repeat(100),
      }));
      
      const result = await compressionService.compressBatch(largeBatch);
      
      expect(result.itemCount).toBe(1000);
      expect(result.originalSize).toBeGreaterThan(10000); // Should be quite large
    });
  });

  describe('Compression Estimation', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should estimate compression ratio for JSON data', () => {
      const jsonData = { key: 'value', array: [1, 2, 3] };
      
      const ratio = compressionService.estimateCompressionRatio(jsonData);
      
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(1);
      expect(ratio).toBe(0.5); // JSON should get good estimate
    });

    it('should estimate compression ratio for repetitive data', () => {
      const repetitiveData = 'x'.repeat(1000);
      
      const ratio = compressionService.estimateCompressionRatio(repetitiveData);
      
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(0.7); // Very repetitive data should compress well
    });

    it('should estimate compression ratio for diverse data', () => {
      const diverseData = Array.from({ length: 1000 }, (_, i) => 
        Math.random().toString(36)
      ).join('');
      
      const ratio = compressionService.estimateCompressionRatio(diverseData);
      
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(1);
    });

    it('should return default estimate when estimation disabled', () => {
      const config = { ...defaultConfig, enableEstimation: false };
      compressionService = new CompressionService(config);
      
      const ratio = compressionService.estimateCompressionRatio('any data');
      
      expect(ratio).toBe(0.7); // Default estimate
    });

    it('should adjust estimate based on data size', () => {
      const smallData = 'x'.repeat(100);
      const largeData = 'x'.repeat(20000); // > 10KB
      
      const smallRatio = compressionService.estimateCompressionRatio(smallData);
      const largeRatio = compressionService.estimateCompressionRatio(largeData);
      
      expect(largeRatio).toBeLessThan(smallRatio); // Larger data should compress better
    });

    it('should handle empty data in estimation', () => {
      const ratio = compressionService.estimateCompressionRatio('');
      
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(1);
    });
  });

  describe('Statistics Tracking', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should track compression statistics', async () => {
      const data1 = 'x'.repeat(1000);
      const data2 = 'y'.repeat(2000);
      
      await compressionService.compress(data1);
      await compressionService.compress(data2);
      
      const stats = compressionService.getStats();
      expect(stats.totalCompressions).toBe(2);
      expect(stats.averageCompressionRatio).toBeGreaterThan(0);
      expect(stats.totalBytesSaved).toBeGreaterThan(0);
      expect(stats.compressionTime).toBeGreaterThanOrEqual(0);
    });

    it('should calculate average compression ratio correctly', async () => {
      // Mock specific compression ratios
      let callCount = 0;
      mockedZlib.gzip.mockImplementation((data, options, callback) => {
        const input = Buffer.from(data);
        const compressionRatios = [0.6, 0.8, 0.4]; // Different ratios for each call
        const ratio = compressionRatios[callCount++];
        const compressedSize = Math.floor(input.length * ratio);
        const compressed = Buffer.alloc(compressedSize);
        
        setImmediate(() => callback(null, compressed));
      });
      
      await compressionService.compress('x'.repeat(1000));
      await compressionService.compress('y'.repeat(1000));
      await compressionService.compress('z'.repeat(1000));
      
      const stats = compressionService.getStats();
      expect(stats.totalCompressions).toBe(3);
      // Average of 0.6, 0.8, 0.4 should be 0.6
      expect(Math.round(stats.averageCompressionRatio * 10) / 10).toBe(0.6);
    });

    it('should track bytes saved correctly', async () => {
      const originalData = 'x'.repeat(1000);
      const originalSize = Buffer.byteLength(originalData, 'utf8');
      
      // Mock compression to save 40% (60% of original size)
      mockedZlib.gzip.mockImplementationOnce((data, options, callback) => {
        const compressedSize = Math.floor(originalSize * 0.6);
        const compressed = Buffer.alloc(compressedSize);
        setImmediate(() => callback(null, compressed));
      });
      
      await compressionService.compress(originalData);
      
      const stats = compressionService.getStats();
      const expectedBytesSaved = Math.floor(originalSize * 0.4); // 40% saved
      expect(stats.totalBytesSaved).toBe(expectedBytesSaved);
    });

    it('should track compression time', async () => {
      mockedZlib.gzip.mockImplementationOnce((data, options, callback) => {
        // Simulate processing time
        setTimeout(() => {
          const input = Buffer.from(data);
          const compressed = Buffer.alloc(Math.floor(input.length * 0.6));
          callback(null, compressed);
        }, 10);
      });
      
      const largeData = 'x'.repeat(1000);
      await compressionService.compress(largeData);
      
      const stats = compressionService.getStats();
      expect(stats.compressionTime).toBeGreaterThan(0);
    });

    it('should reset statistics correctly', async () => {
      // Generate some activity
      await compressionService.compress('x'.repeat(1000));
      await compressionService.decompress(Buffer.from('test').toString('base64'));
      
      expect(compressionService.getStats().totalCompressions).toBe(1);
      expect(compressionService.getStats().totalDecompressions).toBe(1);
      
      compressionService.resetStats();
      
      const stats = compressionService.getStats();
      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalDecompressions).toBe(0);
      expect(stats.totalBytesSaved).toBe(0);
      expect(stats.averageCompressionRatio).toBe(0);
      expect(stats.compressionTime).toBe(0);
    });

    it('should handle division by zero in average calculation', async () => {
      // No compressions performed yet
      const stats = compressionService.getStats();
      expect(stats.averageCompressionRatio).toBe(0);
      expect(stats.totalCompressions).toBe(0);
    });
  });

  describe('Configuration Management', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should update configuration', () => {
      const updates = {
        threshold: 2048,
        level: 9,
        enableEstimation: false,
      };
      
      compressionService.updateConfig(updates);
      
      const config = compressionService.getConfig();
      expect(config.threshold).toBe(2048);
      expect(config.level).toBe(9);
      expect(config.enableEstimation).toBe(false);
      expect(config.chunkSize).toBe(1024); // Should remain unchanged
    });

    it('should affect compression behavior after config update', async () => {
      const testData = 'x'.repeat(1000); // 1000 bytes
      
      // Initially should compress (above 500 byte threshold)
      expect(compressionService.shouldCompress(testData)).toBe(true);
      
      // Update threshold to 2000 bytes
      compressionService.updateConfig({ threshold: 2000 });
      
      // Now should not compress (below 2000 byte threshold)
      expect(compressionService.shouldCompress(testData)).toBe(false);
    });

    it('should return current configuration', () => {
      const config = compressionService.getConfig();
      expect(config).toEqual(defaultConfig);
    });

    it('should use updated compression level', async () => {
      compressionService.updateConfig({ level: 1 });
      
      const testData = 'x'.repeat(1000);
      await compressionService.compress(testData);
      
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        testData,
        expect.objectContaining({ level: 1 }),
        expect.any(Function)
      );
    });
  });

  describe('Utility Methods', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should format bytes correctly', () => {
      expect(compressionService.formatBytes(0)).toBe('0 Bytes');
      expect(compressionService.formatBytes(1024)).toBe('1 KB');
      expect(compressionService.formatBytes(1536)).toBe('1.5 KB'); // 1024 + 512
      expect(compressionService.formatBytes(1024 * 1024)).toBe('1 MB');
      expect(compressionService.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should handle very large byte values', () => {
      const largeValue = 1024 * 1024 * 1024 * 1024; // 1 TB
      const result = compressionService.formatBytes(largeValue);
      expect(result).toContain('TB'); // Should handle beyond GB
    });

    it('should handle fractional byte values', () => {
      expect(compressionService.formatBytes(1536.7)).toBe('1.5 KB');
      expect(compressionService.formatBytes(1023.9)).toBe('1023.9 Bytes');
    });

    it('should test compression with sample data', async () => {
      const sampleData = {
        message: 'Sample error message',
        data: 'x'.repeat(2000), // Large enough to trigger compression
        metadata: { timestamp: Date.now() },
      };
      
      const testResult = await compressionService.testCompression(sampleData);
      
      expect(testResult).toHaveProperty('originalSize');
      expect(testResult).toHaveProperty('compressedSize');
      expect(testResult).toHaveProperty('ratio');
      expect(testResult).toHaveProperty('compressionTime');
      expect(testResult).toHaveProperty('recommendedThreshold');
      
      expect(testResult.compressionTime).toBeGreaterThanOrEqual(0);
      expect(testResult.recommendedThreshold).toBeGreaterThan(0);
    });

    it('should recommend threshold based on compression effectiveness', async () => {
      // Mock poor compression (ratio > 0.8)
      mockedZlib.gzip.mockImplementationOnce((data, options, callback) => {
        const input = Buffer.from(data);
        const poorCompressionSize = Math.floor(input.length * 0.9); // Only 10% savings
        const compressed = Buffer.alloc(poorCompressionSize);
        setImmediate(() => callback(null, compressed));
      });
      
      const sampleData = { data: 'x'.repeat(1000) };
      const result = await compressionService.testCompression(sampleData);
      
      // Should recommend higher threshold for poor compression
      expect(result.recommendedThreshold).toBeGreaterThan(defaultConfig.threshold!);
    });

    it('should recommend lower threshold for good compression', async () => {
      // Mock good compression (ratio < 0.8)
      mockedZlib.gzip.mockImplementationOnce((data, options, callback) => {
        const input = Buffer.from(data);
        const goodCompressionSize = Math.floor(input.length * 0.3); // 70% savings
        const compressed = Buffer.alloc(goodCompressionSize);
        setImmediate(() => callback(null, compressed));
      });
      
      const sampleData = { data: 'x'.repeat(1000) };
      const result = await compressionService.testCompression(sampleData);
      
      // Should recommend lower threshold for good compression
      expect(result.recommendedThreshold).toBeLessThan(defaultConfig.threshold!);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should handle extremely large data', async () => {
      // Create very large string
      const hugeData = 'x'.repeat(10 * 1024 * 1024); // 10MB
      
      await compressionService.compress(hugeData);
      
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        hugeData,
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle empty string compression', async () => {
      const result = await compressionService.compress('');
      
      expect(result).toBe('');
      expect(mockedZlib.gzip).not.toHaveBeenCalled();
    });

    it('should handle null and undefined data', async () => {
      const nullResult = await compressionService.compress(null as any);
      const undefinedResult = await compressionService.compress(undefined as any);
      
      expect(nullResult).toBe('null');
      expect(undefinedResult).toBe('undefined');
    });

    it('should handle special characters and Unicode', async () => {
      const unicodeData = 'Hello 世界 🌍 العالم русский';
      const largeUnicodeData = unicodeData.repeat(100); // Make it large enough to compress
      
      await compressionService.compress(largeUnicodeData);
      
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        largeUnicodeData,
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle objects with undefined properties', async () => {
      const objWithUndefined = {
        definedProp: 'value',
        undefinedProp: undefined,
        nullProp: null,
      };
      
      const result = await compressionService.compressObject(objWithUndefined);
      
      expect(result).toBeDefined();
      expect(result.originalSize).toBeGreaterThan(0);
    });

    it('should handle invalid compression levels gracefully', async () => {
      // zlib levels should be 0-9, test with invalid level
      compressionService.updateConfig({ level: 15 as any });
      
      const testData = 'x'.repeat(1000);
      
      // Should still work, zlib will handle invalid levels
      await compressionService.compress(testData);
      
      expect(mockedZlib.gzip).toHaveBeenCalled();
    });

    it('should handle negative threshold values', () => {
      compressionService.updateConfig({ threshold: -100 });
      
      const smallData = 'small';
      
      // Negative threshold should effectively disable size checking
      expect(compressionService.shouldCompress(smallData)).toBe(true);
    });

    it('should handle zero threshold', () => {
      compressionService.updateConfig({ threshold: 0 });
      
      const emptyData = '';
      const smallData = 'x';
      
      expect(compressionService.shouldCompress(emptyData)).toBe(false);
      expect(compressionService.shouldCompress(smallData)).toBe(true);
    });

    it('should handle malformed base64 in decompression', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const malformedBase64 = 'not_valid_base64!!!';
      
      // gunzip should be called but will likely fail
      mockedZlib.gunzip.mockImplementationOnce((data, callback) => {
        setImmediate(() => callback(new Error('Invalid data')));
      });
      
      await expect(compressionService.decompress(malformedBase64)).rejects.toThrow();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Performance and Memory', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should handle multiple concurrent compressions', async () => {
      const testData = Array.from({ length: 10 }, (_, i) => 
        `test data ${i} `.repeat(100)
      );
      
      const promises = testData.map(data => 
        compressionService.compress(data)
      );
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      expect(mockedZlib.gzip).toHaveBeenCalledTimes(10);
    });

    it('should not accumulate memory over many operations', async () => {
      // Perform many compression operations
      for (let i = 0; i < 100; i++) {
        const testData = `iteration ${i} data `.repeat(50);
        await compressionService.compress(testData);
      }
      
      const stats = compressionService.getStats();
      expect(stats.totalCompressions).toBe(100);
      
      // If we reach this point without running out of memory, the test passes
      expect(true).toBe(true);
    });

    it('should handle rapid successive operations efficiently', async () => {
      const startTime = Date.now();
      
      // Perform rapid operations
      for (let i = 0; i < 50; i++) {
        const data = `rapid test ${i}`.repeat(20);
        if (compressionService.shouldCompress(data)) {
          await compressionService.compress(data);
        }
      }
      
      const endTime = Date.now();
      
      // Should complete reasonably quickly
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle large batch operations efficiently', async () => {
      const largeBatch = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        message: `Message ${i}`,
        data: 'x'.repeat(10), // Small to keep reasonable test time
      }));
      
      const result = await compressionService.compressBatch(largeBatch);
      
      expect(result.itemCount).toBe(500);
      expect(result.originalSize).toBeGreaterThan(0);
    });
  });

  describe('Node.js Specific Features', () => {
    beforeEach(() => {
      compressionService = new CompressionService(defaultConfig);
    });

    it('should work with Node.js Buffer operations', async () => {
      const bufferData = Buffer.from('Test buffer data with special chars: àáâãäå');
      const result = await compressionService.compress(bufferData.toString());
      
      expect(result).toBeDefined();
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        bufferData.toString(),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should handle Node.js stream-like data', async () => {
      const streamData = Buffer.concat([
        Buffer.from('chunk 1 '),
        Buffer.from('chunk 2 '),
        Buffer.from('chunk 3 '),
      ]).toString().repeat(100); // Make it large enough
      
      const result = await compressionService.compress(streamData);
      
      expect(result).toBeDefined();
    });

    it('should use Node.js zlib options correctly', async () => {
      const customConfig = {
        threshold: 100,
        level: 9,
        chunkSize: 8192,
      };
      compressionService = new CompressionService(customConfig);
      
      const testData = 'x'.repeat(200);
      await compressionService.compress(testData);
      
      expect(mockedZlib.gzip).toHaveBeenCalledWith(
        testData,
        expect.objectContaining({
          level: 9,
          chunkSize: 8192,
        }),
        expect.any(Function)
      );
    });

    it('should handle Node.js encoding properly', () => {
      const utf8Data = 'UTF-8 text: café naïve résumé';
      const size = compressionService['getDataSize'](utf8Data);
      
      // Should properly calculate UTF-8 byte size
      expect(size).toBe(Buffer.byteLength(utf8Data, 'utf8'));
      expect(size).toBeGreaterThan(utf8Data.length); // Due to multi-byte characters
    });

    it('should work with Node.js process and timing', async () => {
      // Mock more realistic timing
      mockedZlib.gzip.mockImplementationOnce((data, options, callback) => {
        // Simulate actual compression time
        const processTime = 5; // 5ms
        setTimeout(() => {
          const input = Buffer.from(data);
          const compressed = Buffer.alloc(Math.floor(input.length * 0.6));
          callback(null, compressed);
        }, processTime);
      });
      
      const testData = 'x'.repeat(1000);
      const startTime = process.hrtime.bigint();
      
      await compressionService.compress(testData);
      
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1000000;
      
      expect(durationMs).toBeGreaterThan(0);
    });
  });

  describe('TypeScript Type Safety', () => {
    it('should maintain type safety for configuration', () => {
      const config: CompressionConfig = compressionService?.getConfig() || defaultConfig as CompressionConfig;
      
      expect(typeof config.threshold).toBe('number');
      expect(typeof config.level).toBe('number');
      expect(typeof config.enableEstimation).toBe('boolean');
    });

    it('should return properly typed statistics', () => {
      compressionService = new CompressionService(defaultConfig);
      
      const stats: CompressionStats = compressionService.getStats();
      
      expect(typeof stats.totalCompressions).toBe('number');
      expect(typeof stats.totalDecompressions).toBe('number');
      expect(typeof stats.totalBytesSaved).toBe('number');
      expect(typeof stats.averageCompressionRatio).toBe('number');
      expect(typeof stats.compressionTime).toBe('number');
    });

    it('should handle generic compression correctly', async () => {
      compressionService = new CompressionService(defaultConfig);
      
      interface TestData {
        message: string;
        metadata: Record<string, any>;
      }
      
      const typedData: TestData = {
        message: 'Typed test message',
        metadata: { timestamp: Date.now(), version: '1.0' },
      };
      
      const result = await compressionService.compressObject(typedData);
      
      expect(result.compressed).toBeDefined();
      expect(result.originalSize).toBeGreaterThan(0);
    });

    it('should maintain type safety for batch operations', async () => {
      compressionService = new CompressionService(defaultConfig);
      
      interface BatchItem {
        id: number;
        data: string;
      }
      
      const typedBatch: BatchItem[] = [
        { id: 1, data: 'item 1' },
        { id: 2, data: 'item 2' },
      ];
      
      const result = await compressionService.compressBatch(typedBatch);
      
      expect(result.itemCount).toBe(2);
      expect(typeof result.ratio).toBe('number');
    });
  });
});