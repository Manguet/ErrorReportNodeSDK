import axios, { AxiosInstance, AxiosError } from 'axios';
import { BreadcrumbManager } from './BreadcrumbManager';
import { RateLimiter } from './RateLimiter';
import { OfflineQueue } from './OfflineQueue';
import { CircuitBreaker } from './CircuitBreaker';
import { QuotaManager } from './QuotaManager';
import { RetryManager } from './RetryManager';
import { SDKMonitor } from './SDKMonitor';
import { SecurityValidator } from './SecurityValidator';
import { BatchManager } from './BatchManager';
import { CompressionService } from './CompressionService';
import { ErrorData, ErrorExplorerConfig } from '../types';

export interface EnhancedErrorReporterConfig extends ErrorExplorerConfig {
  // Enhanced configuration options
  quota?: {
    dailyLimit?: number;
    monthlyLimit?: number;
    payloadSizeLimit?: number;
    burstLimit?: number;
    burstWindowMs?: number;
  };
  retry?: {
    maxAttempts?: number;
    delay?: number;
    exponentialBase?: number;
    maxDelay?: number;
  };
  security?: {
    requireHttps?: boolean;
    validateTokens?: boolean;
    maxPayloadSize?: number;
    enableSanitization?: boolean;
  };
  batch?: {
    enabled?: boolean;
    batchSize?: number;
    batchTimeout?: number;
    maxPayloadSize?: number;
  };
  compression?: {
    enabled?: boolean;
    threshold?: number;
    level?: number;
  };
  monitoring?: {
    enabled?: boolean;
    healthCheckInterval?: number;
    performanceThreshold?: number;
  };
  // Additional properties to match with base config
  rateLimit?: {
    requestsPerMinute?: number;
  };
  offlineQueue?: {
    maxSize?: number;
  };
  circuitBreaker?: {
    failureThreshold?: number;
    resetTimeout?: number;
  };
}

export class EnhancedErrorReporter {
  private webhookUrl: string;
  private projectName: string;
  private environment: string;
  private httpClient: AxiosInstance;
  private enabled: boolean;

  // Enhanced services
  private breadcrumbManager!: BreadcrumbManager;
  private rateLimiter!: RateLimiter;
  private offlineQueue!: OfflineQueue;
  private circuitBreaker!: CircuitBreaker;
  private quotaManager?: QuotaManager;
  private retryManager?: RetryManager;
  private sdkMonitor?: SDKMonitor;
  private securityValidator?: SecurityValidator;
  private batchManager?: BatchManager;
  private compressionService?: CompressionService;

  private config: EnhancedErrorReporterConfig;

  constructor(config: EnhancedErrorReporterConfig) {
    this.config = config;
    this.webhookUrl = config.webhookUrl;
    this.projectName = config.projectName;
    this.environment = config.environment || 'production';
    this.enabled = config.enabled !== false;

    this.httpClient = axios.create({
      timeout: config.timeout || 5000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ErrorExplorer-NodeJS-Enhanced/2.0.0',
      },
    });

    this.initializeServices();
  }

  private initializeServices(): void {
    // Core services (always initialized)
    this.breadcrumbManager = new BreadcrumbManager(this.config.maxBreadcrumbs || 50);
    this.rateLimiter = new RateLimiter({
      maxRequests: this.config.rateLimit?.requestsPerMinute || 60,
      windowMs: 60000
    });
    this.offlineQueue = new OfflineQueue({
      maxQueueSize: this.config.offlineQueue?.maxSize || 100
    });
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: this.config.circuitBreaker?.failureThreshold || 5,
      resetTimeout: this.config.circuitBreaker?.resetTimeout || 30000,
    });

    // Enhanced services (conditionally initialized)
    if (this.config.quota) {
      this.quotaManager = new QuotaManager(this.config.quota);
    }

    if (this.config.retry) {
      this.retryManager = new RetryManager(this.config.retry);
    }

    if (this.config.monitoring?.enabled !== false) {
      this.sdkMonitor = new SDKMonitor({
        healthCheckInterval: this.config.monitoring?.healthCheckInterval || 60000,
        performanceThreshold: this.config.monitoring?.performanceThreshold || 5000,
      });
    }

    if (this.config.security) {
      this.securityValidator = new SecurityValidator(this.config.security);
    }

    if (this.config.batch?.enabled) {
      this.batchManager = new BatchManager({
        batchSize: this.config.batch.batchSize || 10,
        batchTimeout: this.config.batch.batchTimeout || 5000,
        maxPayloadSize: this.config.batch.maxPayloadSize,
      });
      this.batchManager.setSendFunction(async (batch) => {
        await this.sendBatch(batch);
      });
    }

    if (this.config.compression?.enabled) {
      this.compressionService = new CompressionService({
        threshold: this.config.compression.threshold || 1024,
        level: this.config.compression.level || 6,
      });
    }

    // Set up offline queue send function
    this.offlineQueue.setSendFunction((data: ErrorData) => this.sendErrorData(data));
  }

  async reportError(error: Error, context?: any): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      // Start monitoring
      const operationId = this.sdkMonitor?.startOperation('error_report') || '';

      // Build error data
      const errorData: ErrorData = {
        message: error.message,
        exception_class: error.name,
        stack_trace: error.stack || '',
        file: '',
        line: 0,
        timestamp: new Date().toISOString(),
        project: this.projectName,
        environment: this.environment,
        breadcrumbs: this.breadcrumbManager.getBreadcrumbs(),
        context: context || {},
      };

      // Security validation
      if (this.securityValidator) {
        const validation = this.securityValidator.validateErrorData(errorData);
        if (!validation.valid) {
          this.sdkMonitor?.endOperation(operationId, false, 'Validation failed');
          console.warn('Error data validation failed:', validation.errors);
          return;
        }

        // Sanitize sensitive data
        const sanitizedData = this.securityValidator.sanitizeSensitiveData(errorData);
        Object.assign(errorData, sanitizedData);
      }

      // Check quotas
      if (this.quotaManager) {
        const payloadSize = JSON.stringify(errorData).length;
        const quotaResult = this.quotaManager.canSendError(payloadSize);
        
        if (!quotaResult.allowed) {
          this.sdkMonitor?.endOperation(operationId, false, quotaResult.reason);
          console.warn('Quota exceeded:', quotaResult.reason);
          
          // Queue for offline processing
          this.offlineQueue.add(errorData);
          return;
        }

        this.quotaManager.recordUsage(payloadSize);
      }

      // Check rate limiting
      const errorHash = this.generateErrorHash(error);
      if (!this.rateLimiter.isAllowed()) {
        this.sdkMonitor?.endOperation(operationId, false, 'Rate limited');
        return;
      }

      // Compress if enabled and data is large enough
      let processedData: ErrorData | string = errorData;
      if (this.compressionService && this.compressionService.shouldCompress(errorData)) {
        processedData = await this.compressionService.compress(errorData);
      }

      // Send via batch or directly
      if (this.batchManager) {
        this.batchManager.addToBatch(errorData);
        this.rateLimiter.recordRequest(true);
        this.sdkMonitor?.endOperation(operationId, true);
      } else {
        await this.sendErrorWithRetry(processedData);
        this.rateLimiter.recordRequest(true);
        this.sdkMonitor?.endOperation(operationId, true);
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.sdkMonitor?.recordError('internal_error', errorMessage);
      
      // Fallback to offline queue
      const errorData: ErrorData = {
        message: error.message,
        exception_class: error.name,
        stack_trace: error.stack || '',
        file: '',
        line: 0,
        timestamp: new Date().toISOString(),
        project: this.projectName,
        environment: this.environment,
        breadcrumbs: this.breadcrumbManager.getBreadcrumbs(),
        context: context || {},
      };
      
      this.offlineQueue.add(errorData);
      console.warn('Error reporting failed, added to offline queue:', errorMessage);
    }
  }

  private async sendErrorWithRetry(data: ErrorData | string): Promise<void> {
    if (this.retryManager) {
      return this.retryManager.executeHttpRequest(
        () => this.sendViaCircuitBreaker(data),
        (error) => this.retryManager!.isRetryableError(error)
      );
    } else {
      return this.sendViaCircuitBreaker(data);
    }
  }

  private async sendViaCircuitBreaker(data: ErrorData | string): Promise<void> {
    return this.circuitBreaker.execute(() => {
      if (typeof data === 'string') {
        // Compressed data
        return this.sendCompressedData(data);
      } else {
        return this.sendErrorData(data);
      }
    });
  }

  private async sendErrorData(data: ErrorData): Promise<void> {
    const response = await this.httpClient.post(this.webhookUrl, data);
    
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  private async sendCompressedData(compressedData: string): Promise<void> {
    const response = await this.httpClient.post(this.webhookUrl, {
      compressed: true,
      data: compressedData,
      metadata: {
        compression: 'gzip-base64',
        sdk: 'nodejs-enhanced',
        version: '2.0.0',
      },
    });
    
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  private async sendBatch(batch: ErrorData[]): Promise<void> {
    const batchPayload = {
      type: 'batch',
      errors: batch,
      timestamp: new Date().toISOString(),
      count: batch.length,
    };

    // Compress batch if service is available and data is large enough
    if (this.compressionService && this.compressionService.shouldCompress(batchPayload)) {
      const compressedBatch = await this.compressionService.compress(batchPayload);
      await this.sendCompressedData(compressedBatch);
    } else {
      const response = await this.httpClient.post(this.webhookUrl, batchPayload);
      
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
  }

  private generateErrorHash(error: Error): string {
    // Enhanced fingerprint combining stack trace signature + message
    const stackSignature = this.extractStackSignature(error.stack || '', 3);
    const messageSignature = (error.message || '').substring(0, 100);
    const errorType = error.constructor.name;
    
    // Combine signatures
    const combined = `${stackSignature}|${messageSignature}|${errorType}`;
    
    // Use crypto hash for consistency
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
  }

  /**
   * Extract stack trace signature by taking the first N meaningful frames
   * and normalizing line numbers to avoid over-segmentation
   */
  private extractStackSignature(stackTrace: string, depth: number = 3): string {
    if (!stackTrace) return '';
    
    const lines = stackTrace.split('\n');
    
    // Filter meaningful frames (ignore Node.js internals and modules)
    const meaningfulFrames = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed && 
             (trimmed.includes('at ') || trimmed.includes('    at ')) &&
             !trimmed.includes('node_modules/') &&
             !trimmed.includes('internal/') &&
             !trimmed.includes('(node:') &&
             (trimmed.includes('.js') || trimmed.includes('.ts') || trimmed.includes('<anonymous>'));
    });
    
    // Take first N frames
    const frames = meaningfulFrames.slice(0, depth);
    
    // Normalize each frame (remove specific line numbers and columns)
    const normalizedFrames = frames.map(frame => {
      return frame.replace(/:\d+:\d+/g, ':XX:XX').replace(/:\d+/g, ':XX');
    });
    
    return normalizedFrames.join('|');
  }

  // Breadcrumb methods
  addBreadcrumb(message: string, category?: string, level?: string, data?: any): void {
    this.breadcrumbManager.addBreadcrumb({
      message,
      category: category || 'custom',
      level: (level || 'info') as any,
      data
    });
  }

  logNavigation(from: string, to: string): void {
    this.breadcrumbManager.logNavigation(from, to);
  }

  logUserAction(action: string, data?: any): void {
    this.breadcrumbManager.logUserAction(action, data);
  }

  logHttpRequest(method: string, url: string, statusCode?: number): void {
    this.breadcrumbManager.logHttpRequest(method, url, statusCode);
  }

  clearBreadcrumbs(): void {
    this.breadcrumbManager.clearBreadcrumbs();
  }

  // Enhanced utility methods
  async flush(): Promise<void> {
    const promises: Promise<any>[] = [];

    // Flush batch manager
    if (this.batchManager) {
      promises.push(this.batchManager.flush());
    }

    // Flush offline queue
    promises.push(this.offlineQueue.flush());

    await Promise.all(promises);
  }

  getStats(): any {
    return {
      rateLimiter: this.rateLimiter.getStats(),
      offlineQueue: this.offlineQueue.getStats(),
      circuitBreaker: this.circuitBreaker.getStats(),
      breadcrumbs: {
        count: this.breadcrumbManager.getBreadcrumbs().length,
        maxSize: this.breadcrumbManager.getMaxBreadcrumbs(),
      },
      quota: this.quotaManager?.getStats(),
      retry: this.retryManager?.getStats(),
      monitor: this.sdkMonitor?.getHealthReport(),
      batch: this.batchManager?.getStats(),
      compression: this.compressionService?.getStats(),
    };
  }

  getHealthReport(): any {
    return this.sdkMonitor?.getHealthReport() || { status: 'monitoring_disabled' };
  }

  // Configuration methods
  updateConfig(updates: Partial<EnhancedErrorReporterConfig>): void {
    this.config = { ...this.config, ...updates };

    // Update service configurations
    if (updates.quota && this.quotaManager) {
      this.quotaManager.updateConfig(updates.quota);
    }

    if (updates.retry && this.retryManager) {
      this.retryManager.updateConfig(updates.retry);
    }

    if (updates.security && this.securityValidator) {
      this.securityValidator.updateConfig(updates.security);
    }

    if (updates.batch && this.batchManager) {
      this.batchManager.updateConfig(updates.batch);
    }

    if (updates.compression && this.compressionService) {
      this.compressionService.updateConfig(updates.compression);
    }

    if (updates.monitoring && this.sdkMonitor) {
      this.sdkMonitor.updateConfig(updates.monitoring);
    }
  }

  getConfig(): EnhancedErrorReporterConfig {
    return { ...this.config };
  }

  // Test and validation methods
  async testConnection(): Promise<{ success: boolean; error?: string; responseTime?: number }> {
    try {
      const startTime = Date.now();
      const testPayload = {
        test: true,
        message: 'Connection test from Enhanced Node.js SDK',
        timestamp: new Date().toISOString(),
        project: this.projectName,
      };

      const response = await this.httpClient.post(this.webhookUrl, testPayload);
      const responseTime = Date.now() - startTime;

      return {
        success: response.status >= 200 && response.status < 300,
        responseTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  validateConfiguration(): { valid: boolean; errors: string[]; warnings: string[] } {
    if (this.securityValidator) {
      return this.securityValidator.validateConfiguration(this.config);
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.webhookUrl) {
      errors.push('Webhook URL is required');
    }

    if (!this.projectName) {
      errors.push('Project name is required');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // Cleanup method
  destroy(): void {
    this.quotaManager?.destroy();
    this.sdkMonitor?.destroy();
    this.batchManager?.destroy();

    // Final flush attempt
    this.flush().catch(error => {
      console.error('Error during final flush:', error);
    });
  }
}