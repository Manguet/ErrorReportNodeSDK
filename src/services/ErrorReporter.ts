import axios, { AxiosInstance } from 'axios';
import {
  ErrorExplorerConfig,
  InternalErrorExplorerConfig,
  ErrorData,
  RequestData,
  ServerData,
  UserContext,
} from '../types';
import { BreadcrumbManager } from './BreadcrumbManager';
import { OfflineQueue } from './OfflineQueue';
import { CircuitBreaker } from './CircuitBreaker';
import { RateLimiter } from './RateLimiter';
import * as os from 'os';
import * as process from 'process';

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ErrorReporter {
  private config: InternalErrorExplorerConfig;
  private breadcrumbManager: BreadcrumbManager;
  private httpClient: AxiosInstance;
  private userContext: UserContext = {};
  private commitHash: string | null = null;
  private offlineQueue: OfflineQueue;
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private queueProcessingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: ErrorExplorerConfig) {
    this.config = {
      environment: 'production',
      enabled: true,
      maxBreadcrumbs: 50,
      timeout: 5000,
      retries: 3,
      transport: 'https',
      // Default error handling callbacks
      onError: (error: Error, context?: Record<string, any>) => {
        console.error('ErrorExplorer:', error.message, context);
      },
      onWarning: (message: string, context?: Record<string, any>) => {
        console.warn('ErrorExplorer:', message, context);
      },
      // Offline queue defaults
      enableOfflineQueue: true,
      maxQueueSize: 100,
      // Rate limiting defaults
      enableRateLimit: true,
      maxRequestsPerMinute: 60,
      // Circuit breaker defaults
      enableCircuitBreaker: true,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 30000,
      ...config,
    };

    this.breadcrumbManager = new BreadcrumbManager(this.config.maxBreadcrumbs);

    // Initialize offline queue
    this.offlineQueue = new OfflineQueue({
      maxQueueSize: this.config.maxQueueSize,
      maxRetries: this.config.retries,
      onError: this.config.onError,
      onWarning: this.config.onWarning,
    });

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: this.config.circuitBreakerThreshold,
      timeout: this.config.circuitBreakerTimeout,
      resetTimeout: this.config.circuitBreakerTimeout * 2,
    });

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter({
      maxRequests: this.config.maxRequestsPerMinute,
      windowMs: 60000, // 1 minute
      skipSuccessful: true,
    });

    this.httpClient = axios.create({
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `ErrorExplorer-Node/${process.version}`,
      },
    });

    if (this.config.userId || this.config.userEmail) {
      this.setUser({
        id: this.config.userId,
        email: this.config.userEmail,
      });
    }

    // Start processing queue periodically (not in test environment)
    if (this.config.enableOfflineQueue && process.env.NODE_ENV !== 'test') {
      this.startQueueProcessing();
    }
  }

  setUser(user: UserContext): void {
    this.userContext = { ...this.userContext, ...user };
  }

  addBreadcrumb(
    message: string,
    category: string = 'custom',
    level: 'debug' | 'info' | 'warning' | 'error' = 'info',
    data?: Record<string, any>
  ): void {
    this.breadcrumbManager.addBreadcrumb({
      message,
      category,
      level,
      data,
    });
  }

  async captureException(error: Error, context?: Record<string, any>, request?: any): Promise<void> {
    if (!this.config.enabled) {
      return Promise.resolve();
    }

    const errorData = await this.formatError(error, context, request);

    if (this.config.beforeSend) {
      const processedData = this.config.beforeSend(errorData);
      if (!processedData) {
        return Promise.resolve();
      }
      return this.sendError(processedData);
    }

    return this.sendError(errorData);
  }

  captureMessage(
    message: string,
    level: 'debug' | 'info' | 'warning' | 'error' = 'info',
    context?: Record<string, any>
  ): Promise<void> {
    const error = new Error(message);
    error.name = 'CapturedMessage';
    return this.captureException(error, { ...context, level });
  }

  private async formatError(error: Error, context?: Record<string, any>, request?: any): Promise<ErrorData> {
    const stack = error.stack || '';
    const lines = stack.split('\n');
    const firstLine = lines[1] || '';
    const match = firstLine.match(/\((.+):(\d+):(\d+)\)/) || firstLine.match(/at (.+):(\d+):(\d+)/);

    const file = match ? match[1] : 'unknown';
    const line = match ? parseInt(match[2], 10) : 0;

    const errorData: ErrorData = {
      message: error.message,
      exception_class: error.constructor.name,
      stack_trace: stack,
      file,
      line,
      project: this.config.projectName,
      environment: this.config.environment,
      commitHash: await this.getCommitHash(),
      timestamp: new Date().toISOString(),
      server: this.getServerData(),
      breadcrumbs: this.breadcrumbManager.getBreadcrumbs(),
      user: Object.keys(this.userContext).length > 0 ? this.userContext : undefined,
      context,
    };

    if (request) {
      errorData.request = this.formatRequest(request);
      if (request.res && request.res.statusCode) {
        errorData.http_status = request.res.statusCode;
      }
    }

    return errorData;
  }

  private async detectCommitHash(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { timeout: 1000 });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  private async getCommitHash(): Promise<string | null> {
    if (this.commitHash === null) {
      this.commitHash = await this.detectCommitHash();
    }
    return this.commitHash;
  }

  private formatRequest(req: any): RequestData {
    const request: RequestData = {};

    if (req.url) request.url = req.url;
    if (req.method) request.method = req.method;
    if (req.headers) {
      request.headers = { ...req.headers };
      if (request.headers) {
        delete request.headers.authorization;
        delete request.headers.cookie;
      }
    }
    if (req.query) request.query = req.query;
    if (req.body && typeof req.body === 'object') {
      request.body = { ...req.body };
      this.sanitizeBody(request.body);
    }
    if (req.ip) request.ip = req.ip;
    if (req.get && req.get('user-agent')) request.user_agent = req.get('user-agent');

    return request;
  }

  private sanitizeBody(body: any): void {
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'authorization'];

    if (typeof body === 'object' && body !== null) {
      for (const key in body) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          body[key] = '[FILTERED]';
        } else if (typeof body[key] === 'object') {
          this.sanitizeBody(body[key]);
        }
      }
    }
  }

  private getServerData(): ServerData {
    const memUsage = process.memoryUsage();

    return {
      node_version: process.version,
      platform: os.platform(),
      arch: os.arch(),
      memory_usage: memUsage.heapUsed,
      uptime: process.uptime(),
      pid: process.pid,
    };
  }

  private async sendError(errorData: ErrorData): Promise<void> {
    // Check rate limiting
    if (this.config.enableRateLimit && !this.rateLimiter.isAllowed()) {
      if (this.config.enableOfflineQueue) {
        this.offlineQueue.enqueue(errorData);
        this.config.onWarning('Rate limited, queued for later sending', { errorData });
        return;
      } else {
        this.config.onWarning('Rate limited, dropping error', { errorData });
        return;
      }
    }

    try {
      // Use circuit breaker if enabled
      if (this.config.enableCircuitBreaker) {
        await this.circuitBreaker.execute(async () => {
          await this.httpClient.post(this.config.webhookUrl, errorData);
        });
      } else {
        await this.httpClient.post(this.config.webhookUrl, errorData);
      }

      // Record successful request
      if (this.config.enableRateLimit) {
        this.rateLimiter.recordRequest(true);
      }
    } catch (error) {
      // Record failed request
      if (this.config.enableRateLimit) {
        this.rateLimiter.recordRequest(false);
      }

      // Queue for offline sending if enabled
      if (this.config.enableOfflineQueue) {
        this.offlineQueue.enqueue(errorData);
        this.config.onWarning(
          'Failed to send error, queued for later',
          { error: (error as Error).message, errorData }
        );
      } else {
        this.config.onError(
          new Error('Failed to send error: ' + (error as Error).message),
          { originalError: error, errorData }
        );
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getBreadcrumbManager(): BreadcrumbManager {
    return this.breadcrumbManager;
  }

  getConfig(): InternalErrorExplorerConfig {
    return { ...this.config };
  }

  getQueueSize(): number {
    return this.offlineQueue.getQueueSize();
  }

  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }

  getRateLimitInfo(): { remaining: number; resetTime: number } {
    return {
      remaining: this.rateLimiter.getRemainingRequests(),
      resetTime: this.rateLimiter.getResetTime(),
    };
  }

  async flushQueue(): Promise<void> {
    await this.processOfflineQueue();
  }

  clearQueue(): void {
    this.offlineQueue.clearQueue();
  }

  private startQueueProcessing(): void {
    // Process queue every 30 seconds
    this.queueProcessingInterval = setInterval(() => {
      this.processOfflineQueue().catch(error => {
        this.config.onWarning('Queue processing failed', { error: error.message });
      });
    }, 30000);
  }

  destroy(): void {
    if (this.queueProcessingInterval) {
      clearInterval(this.queueProcessingInterval);
      this.queueProcessingInterval = null;
    }
  }

  handleError(error: Error, context?: Record<string, any>): void {
    this.config.onError(error, context);
  }

  handleWarning(message: string, context?: Record<string, any>): void {
    this.config.onWarning(message, context);
  }

  private async processOfflineQueue(): Promise<void> {
    await this.offlineQueue.processQueue(async (errorData: ErrorData) => {
      // Send directly without going through rate limiting again
      if (this.config.enableCircuitBreaker) {
        await this.circuitBreaker.execute(async () => {
          await this.httpClient.post(this.config.webhookUrl, errorData);
        });
      } else {
        await this.httpClient.post(this.config.webhookUrl, errorData);
      }
    });
  }
}
