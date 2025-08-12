export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  skipSuccessful?: boolean;
}

interface RequestRecord {
  timestamp: number;
  successful: boolean;
}

export class RateLimiter {
  private requests: RequestRecord[] = [];
  private options: RateLimiterOptions;

  constructor(options: Partial<RateLimiterOptions> = {}) {
    this.options = {
      maxRequests: 10,
      windowMs: 60000, // 1 minute
      skipSuccessful: true,
      ...options,
    };
  }

  isAllowed(): boolean {
    this.cleanExpiredRequests();

    const relevantRequests = this.options.skipSuccessful
      ? this.requests.filter(req => !req.successful)
      : this.requests;

    return relevantRequests.length < this.options.maxRequests;
  }

  recordRequest(successful: boolean = true): void {
    this.cleanExpiredRequests();

    this.requests.push({
      timestamp: Date.now(),
      successful,
    });
  }

  getRequestCount(): number {
    this.cleanExpiredRequests();
    return this.requests.length;
  }

  getRemainingRequests(): number {
    this.cleanExpiredRequests();

    const relevantRequests = this.options.skipSuccessful
      ? this.requests.filter(req => !req.successful)
      : this.requests;

    return Math.max(0, this.options.maxRequests - relevantRequests.length);
  }

  getResetTime(): number {
    if (this.requests.length === 0) {
      return 0;
    }

    const oldestRequest = Math.min(...this.requests.map(req => req.timestamp));
    return oldestRequest + this.options.windowMs;
  }

  reset(): void {
    this.requests = [];
  }

  private cleanExpiredRequests(): void {
    const now = Date.now();
    const cutoff = now - this.options.windowMs;

    this.requests = this.requests.filter(req => req.timestamp > cutoff);
  }

  getStats(): { 
    remainingRequests: number; 
    resetTime: number; 
    currentRequests: number 
  } {
    this.cleanExpiredRequests();
    return {
      remainingRequests: this.getRemainingRequests(),
      resetTime: this.getResetTime(),
      currentRequests: this.requests.length
    };
  }
}
