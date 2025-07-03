export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface CircuitBreakerOptions {
    failureThreshold: number;
    timeout: number;
    resetTimeout: number;
}
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private lastFailureTime;
    private options;
    constructor(options?: Partial<CircuitBreakerOptions>);
    execute<T>(fn: () => Promise<T>): Promise<T>;
    private recordFailure;
    private createTimeoutPromise;
    getState(): CircuitBreakerState;
    getFailureCount(): number;
    reset(): void;
}
//# sourceMappingURL=CircuitBreaker.d.ts.map