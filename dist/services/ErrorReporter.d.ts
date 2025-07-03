import { ErrorExplorerConfig, InternalErrorExplorerConfig, UserContext } from '../types';
import { BreadcrumbManager } from './BreadcrumbManager';
export declare class ErrorReporter {
    private config;
    private breadcrumbManager;
    private httpClient;
    private userContext;
    private commitHash;
    private offlineQueue;
    private circuitBreaker;
    private rateLimiter;
    private queueProcessingInterval;
    constructor(config: ErrorExplorerConfig);
    setUser(user: UserContext): void;
    addBreadcrumb(message: string, category?: string, level?: 'debug' | 'info' | 'warning' | 'error', data?: Record<string, any>): void;
    captureException(error: Error, context?: Record<string, any>, request?: any): Promise<void>;
    captureMessage(message: string, level?: 'debug' | 'info' | 'warning' | 'error', context?: Record<string, any>): Promise<void>;
    private formatError;
    private detectCommitHash;
    private getCommitHash;
    private formatRequest;
    private sanitizeBody;
    private getServerData;
    private sendError;
    private delay;
    getBreadcrumbManager(): BreadcrumbManager;
    getConfig(): InternalErrorExplorerConfig;
    getQueueSize(): number;
    getCircuitBreakerState(): string;
    getRateLimitInfo(): {
        remaining: number;
        resetTime: number;
    };
    flushQueue(): Promise<void>;
    clearQueue(): void;
    private startQueueProcessing;
    destroy(): void;
    handleError(error: Error, context?: Record<string, any>): void;
    handleWarning(message: string, context?: Record<string, any>): void;
    private processOfflineQueue;
}
//# sourceMappingURL=ErrorReporter.d.ts.map