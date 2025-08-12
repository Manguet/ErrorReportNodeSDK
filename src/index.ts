import { ErrorReporter } from './services/ErrorReporter';
import { BreadcrumbManager } from './services/BreadcrumbManager';
import { CircuitBreaker } from './services/CircuitBreaker';
import { OfflineQueue } from './services/OfflineQueue';
import { RateLimiter } from './services/RateLimiter';
import { QuotaManager } from './services/QuotaManager';
import { RetryManager } from './services/RetryManager';
import { SDKMonitor } from './services/SDKMonitor';
import { SecurityValidator } from './services/SecurityValidator';
import { BatchManager } from './services/BatchManager';
import { CompressionService } from './services/CompressionService';
import { ErrorExplorerConfig, ErrorData, UserContext, Breadcrumb, ExpressOptions } from './types';
import {
  createExpressErrorHandler,
  createExpressRequestLogger,
  setupExpressIntegration,
} from './middleware/express';

let _globalErrorReporter: ErrorReporter | null = null; // eslint-disable-line @typescript-eslint/no-unused-vars

export class ErrorExplorer {
  private static instance: ErrorReporter | null = null;

  static init(config: ErrorExplorerConfig): ErrorReporter {
    ErrorExplorer.instance = new ErrorReporter(config);
    _globalErrorReporter = ErrorExplorer.instance;
    return ErrorExplorer.instance;
  }

  static configure(config: ErrorExplorerConfig): ErrorReporter {
    return ErrorExplorer.init(config);
  }

  static getInstance(): ErrorReporter | null {
    return ErrorExplorer.instance;
  }

  static captureException(error: Error, context?: Record<string, any>): Promise<void> {
    if (!ErrorExplorer.instance) {
      console.warn('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
      return Promise.resolve();
    }
    return ErrorExplorer.instance.captureException(error, context);
  }

  static captureMessage(
    message: string,
    level: 'debug' | 'info' | 'warning' | 'error' = 'info',
    context?: Record<string, any>
  ): Promise<void> {
    if (!ErrorExplorer.instance) {
      console.warn('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
      return Promise.resolve();
    }
    return ErrorExplorer.instance.captureMessage(message, level, context);
  }

  static addBreadcrumb(
    message: string,
    category?: string,
    level?: 'debug' | 'info' | 'warning' | 'error',
    data?: Record<string, any>
  ): void {
    if (!ErrorExplorer.instance) {
      console.warn('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
      return;
    }
    ErrorExplorer.instance.addBreadcrumb(message, category, level, data);
  }

  static setUser(user: UserContext): void {
    if (!ErrorExplorer.instance) {
      console.warn('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
      return;
    }
    ErrorExplorer.instance.setUser(user);
  }

  static setupExpress(app: any, options?: ExpressOptions): void {
    if (!ErrorExplorer.instance) {
      throw new Error('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
    }
    setupExpressIntegration(app, ErrorExplorer.instance, options);
  }
}

export function captureException(error: Error, context?: Record<string, any>): Promise<void> {
  return ErrorExplorer.captureException(error, context);
}

export function captureMessage(
  message: string,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, any>
): Promise<void> {
  return ErrorExplorer.captureMessage(message, level, context);
}

export function addBreadcrumb(
  message: string,
  category?: string,
  level?: 'debug' | 'info' | 'warning' | 'error',
  data?: Record<string, any>
): void {
  return ErrorExplorer.addBreadcrumb(message, category, level, data);
}

export function setUser(user: UserContext): void {
  return ErrorExplorer.setUser(user);
}

export function setupExpress(app: any, options?: ExpressOptions): void {
  return ErrorExplorer.setupExpress(app, options);
}

export {
  ErrorReporter,
  BreadcrumbManager,
  CircuitBreaker,
  OfflineQueue,
  RateLimiter,
  QuotaManager,
  RetryManager,
  SDKMonitor,
  SecurityValidator,
  BatchManager,
  CompressionService,
  createExpressErrorHandler,
  createExpressRequestLogger,
  setupExpressIntegration,
};

export type { ErrorExplorerConfig, ErrorData, UserContext, Breadcrumb, ExpressOptions };

export default ErrorExplorer;
