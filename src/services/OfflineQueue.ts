import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ErrorData } from '../types';

export interface QueuedError {
  id: string;
  data: ErrorData;
  timestamp: number;
  attempts: number;
}

export class OfflineQueue {
  private queueFile: string;
  private maxQueueSize: number;
  private maxRetries: number;
  private queue: QueuedError[] = [];
  private isProcessing = false;
  private onError: (error: Error, context?: Record<string, any>) => void;
  private onWarning: (message: string, context?: Record<string, any>) => void;

  constructor(
    options: {
      maxQueueSize?: number;
      maxRetries?: number;
      queueFile?: string;
      onError?: (error: Error, context?: Record<string, any>) => void;
      onWarning?: (message: string, context?: Record<string, any>) => void;
    } = {}
  ) {
    this.maxQueueSize = options.maxQueueSize || 100;
    this.maxRetries = options.maxRetries || 3;
    this.queueFile = options.queueFile || path.join(os.tmpdir(), 'error-explorer-queue.json');
    this.onError = options.onError || ((error) => console.error('ErrorExplorer:', error.message));
    this.onWarning = options.onWarning || ((message) => console.warn('ErrorExplorer:', message));

    this.loadQueue();
  }

  enqueue(data: ErrorData): void {
    const queuedError: QueuedError = {
      id: this.generateId(),
      data,
      timestamp: Date.now(),
      attempts: 0,
    };

    this.queue.push(queuedError);

    // Respect max queue size
    if (this.queue.length > this.maxQueueSize) {
      this.queue.shift(); // Remove oldest item
    }

    this.saveQueue();
  }

  async processQueue(sender: (data: ErrorData) => Promise<void>): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const successfulIds: string[] = [];

      for (const queuedError of [...this.queue]) {
        try {
          await sender(queuedError.data);
          successfulIds.push(queuedError.id);
        } catch (error) {
          queuedError.attempts++;

          if (queuedError.attempts >= this.maxRetries) {
            // Remove after max retries
            successfulIds.push(queuedError.id);
            this.onWarning(
              `Dropping error after ${this.maxRetries} failed attempts`,
              { error, queuedError }
            );
          }
        }
      }

      // Remove successfully sent or failed items
      this.queue = this.queue.filter(item => !successfulIds.includes(item.id));
      this.saveQueue();
    } finally {
      this.isProcessing = false;
    }
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  clearQueue(): void {
    this.queue = [];
    this.saveQueue();
  }

  private loadQueue(): void {
    try {
      if (fs.existsSync(this.queueFile)) {
        const data = fs.readFileSync(this.queueFile, 'utf8');
        const parsed = JSON.parse(data);

        if (Array.isArray(parsed)) {
          this.queue = parsed;
          // Clean up old items (older than 24 hours)
          const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
          this.queue = this.queue.filter(item => item.timestamp > dayAgo);
        }
      }
    } catch (error) {
      this.onWarning('Failed to load queue file', { error });
      this.queue = [];
    }
  }

  private saveQueue(): void {
    try {
      const dir = path.dirname(this.queueFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
    } catch (error) {
      console.warn('ErrorExplorer: Failed to save queue file:', error);
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Alias methods for compatibility
  add(data: ErrorData): void {
    this.enqueue(data);
  }

  setSendFunction(sendFn: (data: ErrorData) => Promise<void>): void {
    // Store the send function for processing queue
    this.sendFunction = sendFn;
  }

  private sendFunction?: (data: ErrorData) => Promise<void>;

  async flush(): Promise<void> {
    if (!this.sendFunction || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const itemsToProcess = [...this.queue];
    
    for (const item of itemsToProcess) {
      try {
        await this.sendFunction(item.data);
        // Remove successful item from queue
        this.queue = this.queue.filter(q => q.id !== item.id);
      } catch (error) {
        item.attempts++;
        if (item.attempts >= this.maxRetries) {
          this.queue = this.queue.filter(q => q.id !== item.id);
        }
      }
    }
    
    this.saveQueue();
    this.isProcessing = false;
  }

  getStats(): { queueSize: number; oldestItem: number | null } {
    return {
      queueSize: this.queue.length,
      oldestItem: this.queue.length > 0 ? this.queue[0].timestamp : null
    };
  }
}
