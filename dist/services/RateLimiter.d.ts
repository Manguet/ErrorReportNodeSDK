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
}
//# sourceMappingURL=RateLimiter.d.ts.map