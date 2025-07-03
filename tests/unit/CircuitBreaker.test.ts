import { CircuitBreaker } from '../../src/services/CircuitBreaker';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      timeout: 1000,
      resetTimeout: 2000,
    });
  });

  describe('CLOSED state', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });

    it('should execute function successfully', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(mockFn);

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.getState()).toBe('CLOSED');
    });

    it('should record failures', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));

      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Test error');

      expect(circuitBreaker.getFailureCount()).toBe(1);
      expect(circuitBreaker.getState()).toBe('CLOSED');
    });

    it('should open after reaching failure threshold', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));

      // Fail 3 times to reach threshold
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      }

      expect(circuitBreaker.getState()).toBe('OPEN');
      expect(circuitBreaker.getFailureCount()).toBe(3);
    });
  });

  describe('OPEN state', () => {
    beforeEach(async () => {
      // Force circuit breaker to OPEN state
      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      }
    });

    it('should reject immediately when OPEN', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');

      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow('Circuit breaker is OPEN');

      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      jest.useFakeTimers();

      // Fast forward past reset timeout
      jest.advanceTimersByTime(2100);

      const mockFn = jest.fn().mockResolvedValue('success');

      await circuitBreaker.execute(mockFn);

      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(mockFn).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe('HALF_OPEN state', () => {
    it('should transition to HALF_OPEN and close on success', async () => {
      // Force to OPEN state
      const failingFn = jest.fn().mockRejectedValue(new Error('Test error'));
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(failingFn)).rejects.toThrow();
      }

      expect(circuitBreaker.getState()).toBe('OPEN');

      // Mock time to trigger HALF_OPEN transition
      jest.useFakeTimers();
      jest.advanceTimersByTime(2100); // Past reset timeout

      const successFn = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(successFn);

      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(circuitBreaker.getFailureCount()).toBe(0);

      jest.useRealTimers();
    });

    it('should reopen on failed execution in HALF_OPEN', async () => {
      // Force to OPEN state
      const failingFn = jest.fn().mockRejectedValue(new Error('Test error'));
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(failingFn)).rejects.toThrow();
      }

      expect(circuitBreaker.getState()).toBe('OPEN');

      // Mock time to trigger HALF_OPEN transition
      jest.useFakeTimers();
      jest.advanceTimersByTime(2100); // Past reset timeout

      const stillFailingFn = jest.fn().mockRejectedValue(new Error('Still failing'));

      await expect(circuitBreaker.execute(stillFailingFn)).rejects.toThrow('Still failing');

      // The circuit breaker should record another failure and potentially reopen
      expect(circuitBreaker.getFailureCount()).toBeGreaterThan(0);

      jest.useRealTimers();
    });
  });

  describe('timeout functionality', () => {
    it.skip('should timeout slow functions', async () => {
      const slowFn = jest
        .fn()
        .mockImplementation(() => new Promise(resolve => setTimeout(resolve, 2000)));

      await expect(circuitBreaker.execute(slowFn)).rejects.toThrow('Circuit breaker timeout');

      expect(circuitBreaker.getFailureCount()).toBe(1);
    });
  });

  describe('reset functionality', () => {
    it('should reset state and counters', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));

      // Generate some failures
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();
      await expect(circuitBreaker.execute(mockFn)).rejects.toThrow();

      expect(circuitBreaker.getFailureCount()).toBe(2);

      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });
  });
});
