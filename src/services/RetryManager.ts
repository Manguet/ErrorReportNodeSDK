export interface RetryConfig {
  maxAttempts: number;
  delay: number;
  exponentialBase: number;
  maxDelay?: number;
  jitter?: boolean;
}

export interface RetryStats {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  averageAttempts: number;
}

export class RetryManager {
  private config: RetryConfig;
  private stats: RetryStats = {
    totalAttempts: 0,
    successfulRetries: 0,
    failedRetries: 0,
    averageAttempts: 0,
  };

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxAttempts: 3,
      delay: 1000,
      exponentialBase: 2,
      maxDelay: 30000, // 30 seconds
      jitter: true,
      ...config,
    };
  }

  async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;
    let attempt = 0;

    while (attempt < this.config.maxAttempts) {
      try {
        this.stats.totalAttempts++;
        const result = await operation();
        
        if (attempt > 0) {
          this.stats.successfulRetries++;
        }
        
        this.updateAverageAttempts();
        return result;
      } catch (error) {
        lastError = error as Error;
        attempt++;

        if (attempt >= this.config.maxAttempts) {
          this.stats.failedRetries++;
          this.updateAverageAttempts();
          break;
        }

        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  async executeWithCallback<T>(
    operation: () => Promise<T>,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<T> {
    let lastError: Error;
    let attempt = 0;

    while (attempt < this.config.maxAttempts) {
      try {
        this.stats.totalAttempts++;
        const result = await operation();
        
        if (attempt > 0) {
          this.stats.successfulRetries++;
        }
        
        this.updateAverageAttempts();
        return result;
      } catch (error) {
        lastError = error as Error;
        attempt++;

        if (attempt >= this.config.maxAttempts) {
          this.stats.failedRetries++;
          this.updateAverageAttempts();
          break;
        }

        if (onRetry) {
          onRetry(attempt, lastError);
        }

        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  private calculateDelay(attempt: number): number {
    let delay = this.config.delay * Math.pow(this.config.exponentialBase, attempt - 1);
    
    // Apply maximum delay limit
    if (this.config.maxDelay) {
      delay = Math.min(delay, this.config.maxDelay);
    }
    
    // Add jitter to prevent thundering herd
    if (this.config.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    return Math.floor(delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private updateAverageAttempts(): void {
    const totalOperations = this.stats.successfulRetries + this.stats.failedRetries;
    if (totalOperations > 0) {
      this.stats.averageAttempts = this.stats.totalAttempts / totalOperations;
    }
  }

  // HTTP-specific retry method
  async executeHttpRequest<T>(
    httpOperation: () => Promise<T>,
    isRetryableError?: (error: Error) => boolean
  ): Promise<T> {
    return this.executeWithCallback(httpOperation, (attempt, error) => {
      if (isRetryableError && !isRetryableError(error)) {
        throw error; // Don't retry non-retryable errors
      }
      
      console.warn(`HTTP request failed (attempt ${attempt}), retrying...`, {
        error: error.message,
        nextRetryIn: this.calculateDelay(attempt + 1),
      });
    });
  }

  // Check if an error is generally retryable
  isRetryableError(error: Error): boolean {
    // Network errors
    if (error.message.includes('ECONNRESET') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ECONNREFUSED')) {
      return true;
    }

    // HTTP status codes - explicitly check for non-retryable auth errors first
    const statusCodeMatch = error.message.match(/HTTP (\d+)/);
    if (statusCodeMatch) {
      const statusCode = parseInt(statusCodeMatch[1], 10);
      // Never retry authentication/authorization errors
      if (statusCode === 401 || statusCode === 403) {
        return false;
      }
      // Only retry specific server errors and rate limiting
      const retryableStatusCodes = [408, 429, 502, 503, 504];
      return retryableStatusCodes.includes(statusCode);
    }

    return false;
  }

  getStats(): RetryStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageAttempts: 0,
    };
  }

  updateConfig(updates: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): RetryConfig {
    return { ...this.config };
  }
}