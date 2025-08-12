export interface RateLimiterOptions {
    maxRequests: number;
    windowMs: number;
    skipSuccessful?: boolean;
}
export declare class RateLimiter {
    private requests;
    private options;
    constructor(options?: Partial<RateLimiterOptions>);
    isAllowed(): boolean;
    recordRequest(successful?: boolean): void;
    getRequestCount(): number;
    getRemainingRequests(): number;
    getResetTime(): number;
    reset(): void;
    private cleanExpiredRequests;
    getStats(): {
        remainingRequests: number;
        resetTime: number;
        currentRequests: number;
    };
}
//# sourceMappingURL=RateLimiter.d.ts.map