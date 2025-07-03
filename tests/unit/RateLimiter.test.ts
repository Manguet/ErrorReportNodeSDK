import { RateLimiter } from '../../src/services/RateLimiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      maxRequests: 3,
      windowMs: 1000, // 1 second
      skipSuccessful: true,
    });
  });

  describe('isAllowed', () => {
    it('should allow requests under the limit', () => {
      expect(rateLimiter.isAllowed()).toBe(true);

      rateLimiter.recordRequest(false); // Failed request
      expect(rateLimiter.isAllowed()).toBe(true);

      rateLimiter.recordRequest(false); // Failed request
      expect(rateLimiter.isAllowed()).toBe(true);
    });

    it('should deny requests over the limit', () => {
      // Record 3 failed requests
      rateLimiter.recordRequest(false);
      rateLimiter.recordRequest(false);
      rateLimiter.recordRequest(false);

      expect(rateLimiter.isAllowed()).toBe(false);
    });

    it('should skip successful requests when configured', () => {
      // Record 3 successful requests - should not count towards limit
      rateLimiter.recordRequest(true);
      rateLimiter.recordRequest(true);
      rateLimiter.recordRequest(true);

      expect(rateLimiter.isAllowed()).toBe(true);
      expect(rateLimiter.getRemainingRequests()).toBe(3);
    });

    it('should count all requests when skipSuccessful is false', () => {
      const strictLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 1000,
        skipSuccessful: false,
      });

      strictLimiter.recordRequest(true);
      strictLimiter.recordRequest(true);

      expect(strictLimiter.isAllowed()).toBe(false);
    });
  });

  describe('time window', () => {
    it('should reset after window expires', async () => {
      jest.useFakeTimers();

      // Fill up the rate limit
      rateLimiter.recordRequest(false);
      rateLimiter.recordRequest(false);
      rateLimiter.recordRequest(false);

      expect(rateLimiter.isAllowed()).toBe(false);

      // Advance time past the window
      jest.advanceTimersByTime(1100);

      expect(rateLimiter.isAllowed()).toBe(true);
      expect(rateLimiter.getRemainingRequests()).toBe(3);

      jest.useRealTimers();
    });

    it('should clean expired requests', () => {
      jest.useFakeTimers();

      rateLimiter.recordRequest(false);

      // Advance time by half the window
      jest.advanceTimersByTime(500);

      rateLimiter.recordRequest(false);

      expect(rateLimiter.getRequestCount()).toBe(2);

      // Advance past first request's expiry
      jest.advanceTimersByTime(600);

      // This should trigger cleanup
      rateLimiter.isAllowed();

      expect(rateLimiter.getRequestCount()).toBe(1);

      jest.useRealTimers();
    });
  });

  describe('getRemainingRequests', () => {
    it('should return correct remaining count', () => {
      expect(rateLimiter.getRemainingRequests()).toBe(3);

      rateLimiter.recordRequest(false);
      expect(rateLimiter.getRemainingRequests()).toBe(2);

      rateLimiter.recordRequest(false);
      expect(rateLimiter.getRemainingRequests()).toBe(1);

      rateLimiter.recordRequest(false);
      expect(rateLimiter.getRemainingRequests()).toBe(0);
    });
  });

  describe('getResetTime', () => {
    it('should return 0 when no requests recorded', () => {
      expect(rateLimiter.getResetTime()).toBe(0);
    });

    it('should return correct reset time', () => {
      jest.useFakeTimers();
      const startTime = Date.now();

      rateLimiter.recordRequest(false);

      const resetTime = rateLimiter.getResetTime();
      expect(resetTime).toBe(startTime + 1000); // windowMs

      jest.useRealTimers();
    });
  });

  describe('reset', () => {
    it('should clear all recorded requests', () => {
      rateLimiter.recordRequest(false);
      rateLimiter.recordRequest(false);

      expect(rateLimiter.getRequestCount()).toBe(2);

      rateLimiter.reset();

      expect(rateLimiter.getRequestCount()).toBe(0);
      expect(rateLimiter.getRemainingRequests()).toBe(3);
      expect(rateLimiter.isAllowed()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle zero max requests', () => {
      const zeroLimiter = new RateLimiter({
        maxRequests: 0,
        windowMs: 1000,
      });

      expect(zeroLimiter.isAllowed()).toBe(false);
      expect(zeroLimiter.getRemainingRequests()).toBe(0);
    });

    it('should handle rapid requests', () => {
      // Simulate rapid fire requests
      for (let i = 0; i < 10; i++) {
        rateLimiter.recordRequest(false);
      }

      expect(rateLimiter.getRequestCount()).toBe(10);
      expect(rateLimiter.isAllowed()).toBe(false);
      expect(rateLimiter.getRemainingRequests()).toBe(0);
    });
  });
});
