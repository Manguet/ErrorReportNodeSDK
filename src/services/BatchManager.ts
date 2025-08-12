import { ErrorData } from '../types';
import { setTimeout as setTimeoutPromise } from 'timers/promises';

export interface BatchConfig {
  batchSize: number;
  batchTimeout: number;
  maxPayloadSize?: number;
  enableHistory?: boolean;
  maxHistorySize?: number;
}

export interface BatchStats {
  currentSize: number;
  totalBatches: number;
  totalErrors: number;
  averageBatchSize: number;
  lastSentAt?: number;
  history?: BatchHistoryEntry[];
}

export interface BatchHistoryEntry {
  timestamp: number;
  size: number;
  payloadSize: number;
  success: boolean;
  error?: string;
}

export class BatchManager {
  private config: BatchConfig;
  private currentBatch: ErrorData[] = [];
  private sendFunction?: (batch: ErrorData[]) => Promise<void>;
  private batchTimeout?: NodeJS.Timeout;
  private stats: BatchStats = {
    currentSize: 0,
    totalBatches: 0,
    totalErrors: 0,
    averageBatchSize: 0,
    history: [],
  };

  constructor(config: Partial<BatchConfig> = {}) {
    this.config = {
      batchSize: 10,
      batchTimeout: 5000, // 5 seconds
      maxPayloadSize: 512000, // 500KB
      enableHistory: true,
      maxHistorySize: 100,
      ...config,
    };

    if (this.config.enableHistory) {
      this.stats.history = [];
    }
  }

  setSendFunction(sendFunction: (batch: ErrorData[]) => Promise<void>): void {
    this.sendFunction = sendFunction;
  }

  addToBatch(errorData: ErrorData): void {
    this.currentBatch.push(errorData);
    this.stats.currentSize = this.currentBatch.length;
    this.stats.totalErrors++;

    // Check if batch is ready to send
    if (this.currentBatch.length >= this.config.batchSize) {
      this.flush();
    } else {
      // Set timeout for current batch if not already set
      if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(() => {
          this.flush();
        }, this.config.batchTimeout);
      }
    }
  }

  async flush(): Promise<void> {
    if (this.currentBatch.length === 0 || !this.sendFunction) {
      return;
    }

    const batchToSend = [...this.currentBatch];
    const payloadSize = this.calculateBatchSize(batchToSend);
    
    // Clear current batch and timeout
    this.currentBatch = [];
    this.stats.currentSize = 0;
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = undefined;
    }

    // Check payload size limit
    if (this.config.maxPayloadSize && payloadSize > this.config.maxPayloadSize) {
      console.warn(`Batch payload size (${payloadSize}) exceeds limit (${this.config.maxPayloadSize}). Splitting batch.`);
      await this.sendBatchInChunks(batchToSend);
    } else {
      await this.sendBatch(batchToSend);
    }
  }

  private async sendBatch(batch: ErrorData[]): Promise<void> {
    if (!this.sendFunction) {
      throw new Error('Send function not set');
    }

    const startTime = Date.now();
    const payloadSize = this.calculateBatchSize(batch);

    try {
      await this.sendFunction(batch);
      
      // Update stats
      this.stats.totalBatches++;
      this.stats.lastSentAt = Date.now();
      this.updateAverageBatchSize(batch.length);

      // Record history
      if (this.config.enableHistory) {
        this.addToHistory({
          timestamp: startTime,
          size: batch.length,
          payloadSize,
          success: true,
        });
      }

      console.log(`Successfully sent batch of ${batch.length} errors (${payloadSize} bytes)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Record failed batch in history
      if (this.config.enableHistory) {
        this.addToHistory({
          timestamp: startTime,
          size: batch.length,
          payloadSize,
          success: false,
          error: errorMessage,
        });
      }

      console.error(`Failed to send batch of ${batch.length} errors:`, errorMessage);
      throw error;
    }
  }

  private async sendBatchInChunks(batch: ErrorData[]): Promise<void> {
    const chunks: ErrorData[][] = [];
    let currentChunk: ErrorData[] = [];
    let currentChunkSize = 0;

    for (const errorData of batch) {
      const errorSize = this.calculateItemSize(errorData);
      
      if (currentChunkSize + errorSize > this.config.maxPayloadSize! && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [errorData];
        currentChunkSize = errorSize;
      } else {
        currentChunk.push(errorData);
        currentChunkSize += errorSize;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    // Send chunks sequentially
    for (const chunk of chunks) {
      await this.sendBatch(chunk);
      
      // Small delay between chunks to avoid overwhelming the server
      if (chunks.length > 1) {
        await this.sleep(100);
      }
    }
  }

  private calculateBatchSize(batch: ErrorData[]): number {
    return Buffer.byteLength(JSON.stringify(batch), 'utf8');
  }

  private calculateItemSize(errorData: ErrorData): number {
    return Buffer.byteLength(JSON.stringify(errorData), 'utf8');
  }

  private updateAverageBatchSize(batchSize: number): void {
    const totalBatches = this.stats.totalBatches;
    if (totalBatches === 1) {
      this.stats.averageBatchSize = batchSize;
    } else {
      this.stats.averageBatchSize = (
        (this.stats.averageBatchSize * (totalBatches - 1) + batchSize) / totalBatches
      );
    }
  }

  private addToHistory(entry: BatchHistoryEntry): void {
    if (!this.stats.history) {
      return;
    }

    this.stats.history.push(entry);

    // Maintain max history size
    if (this.stats.history.length > (this.config.maxHistorySize || 100)) {
      this.stats.history = this.stats.history.slice(-(this.config.maxHistorySize || 100));
    }
  }

  private sleep(ms: number): Promise<void> {
    return setTimeoutPromise(ms);
  }

  getStats(): BatchStats {
    return {
      ...this.stats,
      history: this.config.enableHistory ? [...(this.stats.history || [])] : undefined,
    };
  }

  getCurrentBatch(): ErrorData[] {
    return [...this.currentBatch];
  }

  clearCurrentBatch(): void {
    this.currentBatch = [];
    this.stats.currentSize = 0;
    
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = undefined;
    }
  }

  updateConfig(updates: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...updates };
    
    // If history was disabled, clear it
    if (!this.config.enableHistory && this.stats.history) {
      this.stats.history = [];
    }
    
    // If history was enabled, initialize it
    if (this.config.enableHistory && !this.stats.history) {
      this.stats.history = [];
    }
  }

  getConfig(): BatchConfig {
    return { ...this.config };
  }

  resetStats(): void {
    this.stats = {
      currentSize: this.currentBatch.length,
      totalBatches: 0,
      totalErrors: 0,
      averageBatchSize: 0,
      history: this.config.enableHistory ? [] : undefined,
    };
  }

  destroy(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = undefined;
    }
    
    // Try to flush any remaining items
    if (this.currentBatch.length > 0) {
      this.flush().catch(error => {
        console.error('Error flushing batch during destroy:', error);
      });
    }
  }
}