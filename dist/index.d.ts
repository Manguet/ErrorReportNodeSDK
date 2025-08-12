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
import { createExpressErrorHandler, createExpressRequestLogger, setupExpressIntegration } from './middleware/express';
export declare class ErrorExplorer {
    private static instance;
    static init(config: ErrorExplorerConfig): ErrorReporter;
    static configure(config: ErrorExplorerConfig): ErrorReporter;
    static getInstance(): ErrorReporter | null;
    static captureException(error: Error, context?: Record<string, any>): Promise<void>;
    static captureMessage(message: string, level?: 'debug' | 'info' | 'warning' | 'error', context?: Record<string, any>): Promise<void>;
    static addBreadcrumb(message: string, category?: string, level?: 'debug' | 'info' | 'warning' | 'error', data?: Record<string, any>): void;
    static setUser(user: UserContext): void;
    static setupExpress(app: any, options?: ExpressOptions): void;
}
export declare function captureException(error: Error, context?: Record<string, any>): Promise<void>;
export declare function captureMessage(message: string, level?: 'debug' | 'info' | 'warning' | 'error', context?: Record<string, any>): Promise<void>;
export declare function addBreadcrumb(message: string, category?: string, level?: 'debug' | 'info' | 'warning' | 'error', data?: Record<string, any>): void;
export declare function setUser(user: UserContext): void;
export declare function setupExpress(app: any, options?: ExpressOptions): void;
export { ErrorReporter, BreadcrumbManager, CircuitBreaker, OfflineQueue, RateLimiter, QuotaManager, RetryManager, SDKMonitor, SecurityValidator, BatchManager, CompressionService, createExpressErrorHandler, createExpressRequestLogger, setupExpressIntegration, };
export type { ErrorExplorerConfig, ErrorData, UserContext, Breadcrumb, ExpressOptions };
export default ErrorExplorer;
//# sourceMappingURL=index.d.ts.map