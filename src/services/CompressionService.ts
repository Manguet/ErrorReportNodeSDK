import * as zlib from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export interface CompressionConfig {
  threshold: number;
  level: number;
  enableEstimation: boolean;
  chunkSize?: number;
}

export interface CompressionStats {
  totalCompressions: number;
  totalDecompressions: number;
  totalBytesSaved: number;
  averageCompressionRatio: number;
  compressionTime: number;
}

export class CompressionService {
  private config: CompressionConfig;
  private stats: CompressionStats = {
    totalCompressions: 0,
    totalDecompressions: 0,
    totalBytesSaved: 0,
    averageCompressionRatio: 0,
    compressionTime: 0,
  };

  constructor(config: Partial<CompressionConfig> = {}) {
    this.config = {
      threshold: 1024, // 1KB
      level: 6, // zlib compression level (1-9)
      enableEstimation: true,
      chunkSize: 16 * 1024, // 16KB chunks for large data
      ...config,
    };
  }

  shouldCompress(data: string | Buffer | any): boolean {
    const size = this.getDataSize(data);
    return size > this.config.threshold;
  }

  async compress(data: string | any): Promise<string> {
    const startTime = Date.now();
    const inputData = typeof data === 'string' ? data : JSON.stringify(data);
    const originalSize = Buffer.byteLength(inputData, 'utf8');

    if (!this.shouldCompress(inputData)) {
      return inputData;
    }

    try {
      const compressed = await gzipAsync(inputData, {
        level: this.config.level,
        chunkSize: this.config.chunkSize,
      });

      const compressedSize = compressed.length;
      const compressionTime = Date.now() - startTime;

      // Update statistics
      this.updateCompressionStats(originalSize, compressedSize, compressionTime);

      // Return base64 encoded compressed data
      return compressed.toString('base64');
    } catch (error) {
      console.error('Compression failed:', error);
      // Return original data if compression fails
      return inputData;
    }
  }

  async decompress(compressedData: string): Promise<string> {
    const startTime = Date.now();

    try {
      const buffer = Buffer.from(compressedData, 'base64');
      const decompressed = await gunzipAsync(buffer);
      
      const decompressionTime = Date.now() - startTime;
      this.stats.totalDecompressions++;
      
      console.log(`Decompression completed in ${decompressionTime}ms`);
      
      return decompressed.toString('utf8');
    } catch (error) {
      console.error('Decompression failed:', error);
      throw new Error(`Failed to decompress data: ${(error as Error).message}`);
    }
  }

  async compressObject(obj: any): Promise<{
    compressed: string;
    originalSize: number;
    compressedSize: number;
    ratio: number;
  }> {
    const jsonString = JSON.stringify(obj);
    const originalSize = Buffer.byteLength(jsonString, 'utf8');
    
    const compressed = await this.compress(jsonString);
    const compressedSize = Buffer.byteLength(compressed, 'utf8');
    const ratio = originalSize > 0 ? compressedSize / originalSize : 1;

    return {
      compressed,
      originalSize,
      compressedSize,
      ratio,
    };
  }

  async compressBatch<T>(items: T[]): Promise<{
    compressed: string;
    originalSize: number;
    compressedSize: number;
    ratio: number;
    itemCount: number;
  }> {
    const batchData = {
      items,
      timestamp: new Date().toISOString(),
      count: items.length,
    };

    const result = await this.compressObject(batchData);
    
    return {
      ...result,
      itemCount: items.length,
    };
  }

  estimateCompressionRatio(data: string | any): number {
    if (!this.config.enableEstimation) {
      return 0.7; // Default estimate
    }

    const inputData = typeof data === 'string' ? data : JSON.stringify(data);
    const size = Buffer.byteLength(inputData, 'utf8');

    // Simple heuristic based on content characteristics
    let estimatedRatio = 0.7; // Default

    // JSON data typically compresses well
    if (inputData.includes('{') && inputData.includes('}')) {
      estimatedRatio = 0.5;
    }

    // Repetitive data compresses better
    const uniqueChars = new Set(inputData).size;
    const repetitionRatio = uniqueChars / inputData.length;
    estimatedRatio *= (0.5 + repetitionRatio * 0.5);

    // Larger data typically has better compression ratios
    if (size > 10000) {
      estimatedRatio *= 0.8;
    }

    return Math.max(0.1, Math.min(1.0, estimatedRatio));
  }

  private getDataSize(data: string | Buffer | any): number {
    if (Buffer.isBuffer(data)) {
      return data.length;
    }
    
    if (typeof data === 'string') {
      return Buffer.byteLength(data, 'utf8');
    }
    
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  }

  private updateCompressionStats(originalSize: number, compressedSize: number, compressionTime: number): void {
    const bytesSaved = originalSize - compressedSize;
    const ratio = originalSize > 0 ? compressedSize / originalSize : 1;

    this.stats.totalCompressions++;
    this.stats.totalBytesSaved += bytesSaved;
    this.stats.compressionTime += compressionTime;

    // Update average compression ratio
    const totalCompressions = this.stats.totalCompressions;
    if (totalCompressions === 1) {
      this.stats.averageCompressionRatio = ratio;
    } else {
      this.stats.averageCompressionRatio = (
        (this.stats.averageCompressionRatio * (totalCompressions - 1) + ratio) / totalCompressions
      );
    }

    console.log(`Compression: ${originalSize} -> ${compressedSize} bytes (${Math.round(ratio * 100)}% ratio) in ${compressionTime}ms`);
  }

  getStats(): CompressionStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalCompressions: 0,
      totalDecompressions: 0,
      totalBytesSaved: 0,
      averageCompressionRatio: 0,
      compressionTime: 0,
    };
  }

  updateConfig(updates: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): CompressionConfig {
    return { ...this.config };
  }

  // Utility method to format byte sizes
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Method to test compression with sample data
  async testCompression(sampleData: any): Promise<{
    originalSize: string;
    compressedSize: string;
    ratio: number;
    compressionTime: number;
    recommendedThreshold: number;
  }> {
    const startTime = Date.now();
    const result = await this.compressObject(sampleData);
    const compressionTime = Date.now() - startTime;

    // Recommend threshold based on the compression effectiveness
    const recommendedThreshold = result.ratio > 0.8 ? this.config.threshold * 2 : this.config.threshold / 2;

    return {
      originalSize: this.formatBytes(result.originalSize),
      compressedSize: this.formatBytes(result.compressedSize),
      ratio: Math.round(result.ratio * 100) / 100,
      compressionTime,
      recommendedThreshold,
    };
  }
}