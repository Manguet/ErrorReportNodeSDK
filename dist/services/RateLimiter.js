"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
class RateLimiter {
    constructor(options = {}) {
        this.requests = [];
        this.options = {
            maxRequests: 10,
            windowMs: 60000,
            skipSuccessful: true,
            ...options,
        };
    }
    isAllowed() {
        this.cleanExpiredRequests();
        const relevantRequests = this.options.skipSuccessful
            ? this.requests.filter(req => !req.successful)
            : this.requests;
        return relevantRequests.length < this.options.maxRequests;
    }
    recordRequest(successful = true) {
        this.cleanExpiredRequests();
        this.requests.push({
            timestamp: Date.now(),
            successful,
        });
    }
    getRequestCount() {
        this.cleanExpiredRequests();
        return this.requests.length;
    }
    getRemainingRequests() {
        this.cleanExpiredRequests();
        const relevantRequests = this.options.skipSuccessful
            ? this.requests.filter(req => !req.successful)
            : this.requests;
        return Math.max(0, this.options.maxRequests - relevantRequests.length);
    }
    getResetTime() {
        if (this.requests.length === 0) {
            return 0;
        }
        const oldestRequest = Math.min(...this.requests.map(req => req.timestamp));
        return oldestRequest + this.options.windowMs;
    }
    reset() {
        this.requests = [];
    }
    cleanExpiredRequests() {
        const now = Date.now();
        const cutoff = now - this.options.windowMs;
        this.requests = this.requests.filter(req => req.timestamp > cutoff);
    }
    getStats() {
        this.cleanExpiredRequests();
        return {
            remainingRequests: this.getRemainingRequests(),
            resetTime: this.getResetTime(),
            currentRequests: this.requests.length
        };
    }
}
exports.RateLimiter = RateLimiter;
//# sourceMappingURL=RateLimiter.js.map