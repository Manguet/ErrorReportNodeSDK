import { SDKMonitor, PerformanceMetric, HealthReport, MonitorConfig } from '../../src/services/SDKMonitor';

describe('SDKMonitor', () => {
  let monitor: SDKMonitor;
  let defaultConfig: Partial<MonitorConfig>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-01-15T12:00:00Z'));

    defaultConfig = {
      maxMetricsHistory: 100,
      healthCheckInterval: 60000, // 1 minute
      performanceThreshold: 2000, // 2 seconds
      errorRateThreshold: 0.05, // 5%
    };

    // Mock process.memoryUsage()
    const mockMemoryUsage = jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 50 * 1024 * 1024, // 50MB
      heapTotal: 30 * 1024 * 1024, // 30MB  
      heapUsed: 20 * 1024 * 1024, // 20MB
      external: 5 * 1024 * 1024, // 5MB
      arrayBuffers: 1 * 1024 * 1024, // 1MB
    });
  });

  afterEach(() => {
    if (monitor) {
      monitor.destroy();
    }
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should create instance with default configuration', () => {
      monitor = new SDKMonitor();
      
      const config = monitor.getConfig();
      expect(config.maxMetricsHistory).toBe(1000);
      expect(config.healthCheckInterval).toBe(60000);
      expect(config.performanceThreshold).toBe(5000);
      expect(config.errorRateThreshold).toBe(0.1);
    });

    it('should create instance with custom configuration', () => {
      monitor = new SDKMonitor(defaultConfig);
      
      const config = monitor.getConfig();
      expect(config.maxMetricsHistory).toBe(100);
      expect(config.healthCheckInterval).toBe(60000);
      expect(config.performanceThreshold).toBe(2000);
      expect(config.errorRateThreshold).toBe(0.05);
    });

    it('should merge custom config with defaults', () => {
      const partialConfig = { maxMetricsHistory: 500 };
      monitor = new SDKMonitor(partialConfig);
      
      const config = monitor.getConfig();
      expect(config.maxMetricsHistory).toBe(500);
      expect(config.healthCheckInterval).toBe(60000); // default
      expect(config.performanceThreshold).toBe(5000); // default
    });

    it('should start health checks automatically', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      
      monitor = new SDKMonitor(defaultConfig);
      
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        60000
      );
    });

    it('should initialize with current start time', () => {
      monitor = new SDKMonitor(defaultConfig);
      
      const report = monitor.getHealthReport();
      expect(report.uptime).toBe(0); // Just started
    });
  });

  describe('Operation Tracking', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should start and end operation successfully', () => {
      const operationId = monitor.startOperation('test_operation');
      
      expect(operationId).toMatch(/^op_\d+_[a-z0-9]+$/);
      
      // Advance time and end operation
      jest.advanceTimersByTime(1000);
      monitor.endOperation(operationId, true);
      
      const metrics = monitor.getMetrics('test_operation');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operationType).toBe('test_operation');
      expect(metrics[0].success).toBe(true);
      expect(metrics[0].duration).toBe(1000);
    });

    it('should handle operation failure', () => {
      const operationId = monitor.startOperation('failing_operation');
      
      jest.advanceTimersByTime(500);
      monitor.endOperation(operationId, false, 'Operation failed');
      
      const metrics = monitor.getMetrics('failing_operation');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].success).toBe(false);
      expect(metrics[0].error).toBe('Operation failed');
      expect(metrics[0].duration).toBe(500);
    });

    it('should ignore ending non-existent operations', () => {
      monitor.endOperation('non-existent-id', true);
      
      const allMetrics = monitor.getMetrics();
      expect(allMetrics).toHaveLength(0);
    });

    it('should generate unique operation IDs', () => {
      const id1 = monitor.startOperation('test');
      const id2 = monitor.startOperation('test');
      const id3 = monitor.startOperation('test');
      
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should handle concurrent operations', () => {
      const id1 = monitor.startOperation('concurrent_op');
      const id2 = monitor.startOperation('concurrent_op');
      
      jest.advanceTimersByTime(100);
      monitor.endOperation(id1, true);
      
      jest.advanceTimersByTime(200); // Total: 300ms for id2
      monitor.endOperation(id2, false, 'Error');
      
      const metrics = monitor.getMetrics('concurrent_op');
      expect(metrics).toHaveLength(2);
      
      const successMetric = metrics.find(m => m.success);
      const failMetric = metrics.find(m => !m.success);
      
      expect(successMetric?.duration).toBe(100);
      expect(failMetric?.duration).toBe(300);
    });
  });

  describe('Direct Metric Recording', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should record operation with duration', () => {
      monitor.recordOperation('direct_op', 1500, true);
      
      const metrics = monitor.getMetrics('direct_op');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].duration).toBe(1500);
      expect(metrics[0].success).toBe(true);
      expect(metrics[0].endTime).toBeGreaterThan(metrics[0].startTime!);
    });

    it('should record error operation', () => {
      monitor.recordError('error_op', 'Critical error');
      
      const metrics = monitor.getMetrics('error_op');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].success).toBe(false);
      expect(metrics[0].error).toBe('Critical error');
      expect(metrics[0].duration).toBe(0);
    });

    it('should record success operation', () => {
      monitor.recordSuccess('success_op', 800);
      
      const metrics = monitor.getMetrics('success_op');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].success).toBe(true);
      expect(metrics[0].duration).toBe(800);
    });

    it('should handle success operation without duration', () => {
      monitor.recordSuccess('quick_op');
      
      const metrics = monitor.getMetrics('quick_op');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].duration).toBe(0);
    });
  });

  describe('Metrics Management', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should maintain maximum metrics history', () => {
      // Record more metrics than the limit
      for (let i = 0; i < 150; i++) {
        monitor.recordOperation(`op_${i}`, 100, true);
      }
      
      const allMetrics = monitor.getMetrics();
      expect(allMetrics.length).toBe(100); // Should be limited to maxMetricsHistory
    });

    it('should keep most recent metrics when exceeding limit', () => {
      for (let i = 0; i < 150; i++) {
        monitor.recordOperation(`op_${i}`, 100, true);
      }
      
      const allMetrics = monitor.getMetrics();
      const firstMetric = allMetrics[0];
      const lastMetric = allMetrics[allMetrics.length - 1];
      
      // Should have metrics from op_50 to op_149 (last 100)
      expect(firstMetric.operationType).toBe('op_50');
      expect(lastMetric.operationType).toBe('op_149');
    });

    it('should filter metrics by operation type', () => {
      monitor.recordOperation('type_a', 100, true);
      monitor.recordOperation('type_b', 200, false, 'Error');
      monitor.recordOperation('type_a', 300, true);
      
      const typeAMetrics = monitor.getMetrics('type_a');
      expect(typeAMetrics).toHaveLength(2);
      expect(typeAMetrics.every(m => m.operationType === 'type_a')).toBe(true);
      
      const typeBMetrics = monitor.getMetrics('type_b');
      expect(typeBMetrics).toHaveLength(1);
      expect(typeBMetrics[0].operationType).toBe('type_b');
    });

    it('should limit metrics by count', () => {
      for (let i = 0; i < 20; i++) {
        monitor.recordOperation('limited_op', 100, true);
      }
      
      const limitedMetrics = monitor.getMetrics('limited_op', 5);
      expect(limitedMetrics).toHaveLength(5);
    });

    it('should return copy of metrics to prevent external modification', () => {
      monitor.recordOperation('test_op', 100, true);
      
      const metrics1 = monitor.getMetrics('test_op');
      const metrics2 = monitor.getMetrics('test_op');
      
      expect(metrics1).not.toBe(metrics2); // Different array instances
      expect(metrics1).toEqual(metrics2); // Same content
      
      // Modifying returned array should not affect internal state
      metrics1.push({} as any);
      const metrics3 = monitor.getMetrics('test_op');
      expect(metrics3).toHaveLength(1);
    });

    it('should clear all metrics', () => {
      monitor.recordOperation('op1', 100, true);
      monitor.recordOperation('op2', 200, false, 'Error');
      
      expect(monitor.getMetrics()).toHaveLength(2);
      
      monitor.clearMetrics();
      
      expect(monitor.getMetrics()).toHaveLength(0);
    });
  });

  describe('Operation Statistics', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should calculate operation statistics correctly', () => {
      monitor.recordOperation('stats_op', 100, true);
      monitor.recordOperation('stats_op', 200, true);
      monitor.recordOperation('stats_op', 300, false, 'Error');
      monitor.recordOperation('stats_op', 150, true);
      
      const stats = monitor.getOperationStats('stats_op');
      
      expect(stats.totalCount).toBe(4);
      expect(stats.successCount).toBe(3);
      expect(stats.errorCount).toBe(1);
      expect(stats.averageDuration).toBe(187); // (100+200+300+150)/4 rounded
      expect(stats.successRate).toBe(0.75); // 3/4
    });

    it('should handle empty operation statistics', () => {
      const stats = monitor.getOperationStats('nonexistent_op');
      
      expect(stats.totalCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.averageDuration).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should handle operations with zero duration', () => {
      monitor.recordOperation('zero_duration', 0, true);
      monitor.recordOperation('zero_duration', 0, false);
      
      const stats = monitor.getOperationStats('zero_duration');
      
      expect(stats.averageDuration).toBe(0);
      expect(stats.totalCount).toBe(2);
    });

    it('should round average duration correctly', () => {
      monitor.recordOperation('round_test', 333, true);
      monitor.recordOperation('round_test', 334, true);
      monitor.recordOperation('round_test', 333, true);
      
      const stats = monitor.getOperationStats('round_test');
      
      expect(stats.averageDuration).toBe(333); // 1000/3 = 333.33... rounded to 333
    });
  });

  describe('Health Monitoring', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should generate health report with basic metrics', () => {
      monitor.recordOperation('op1', 1000, true);
      monitor.recordOperation('op2', 500, false, 'Error');
      
      const report = monitor.getHealthReport();
      
      expect(report.healthScore).toBeGreaterThan(0);
      expect(report.totalOperations).toBe(2);
      expect(report.successfulOperations).toBe(1);
      expect(report.failedOperations).toBe(1);
      expect(report.averageResponseTime).toBe(750); // (1000+500)/2
      expect(report.errorRate).toBe(0.5); // 1/2
      expect(report.memoryUsage).toBeDefined();
      expect(report.uptime).toBeGreaterThanOrEqual(0);
      expect(report.recommendations).toBeDefined();
    });

    it('should calculate health score based on error rate', () => {
      // High error rate scenario
      for (let i = 0; i < 8; i++) {
        monitor.recordOperation('failing_op', 500, false, 'Error');
      }
      for (let i = 0; i < 2; i++) {
        monitor.recordOperation('success_op', 500, true);
      }
      
      const report = monitor.getHealthReport();
      
      expect(report.errorRate).toBe(0.8); // 8/10
      expect(report.healthScore).toBeLessThan(100); // Should be penalized
    });

    it('should calculate health score based on performance', () => {
      // Slow response times
      for (let i = 0; i < 5; i++) {
        monitor.recordOperation('slow_op', 10000, true); // 10 seconds (> threshold)
      }
      
      const report = monitor.getHealthReport();
      
      expect(report.averageResponseTime).toBe(10000);
      expect(report.healthScore).toBeLessThan(100); // Should be penalized for slowness
    });

    it('should penalize high memory usage in health score', () => {
      // Mock high memory usage
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        heapUsed: 75 * 1024 * 1024, // 93.75% heap usage
        external: 5 * 1024 * 1024,
        arrayBuffers: 1 * 1024 * 1024,
      });
      
      monitor.recordOperation('test_op', 100, true);
      
      const report = monitor.getHealthReport();
      
      expect(report.healthScore).toBeLessThan(100); // Should be penalized for memory usage
    });

    it('should cap health score at 0 and 100', () => {
      // Scenario with extremely high error rate and slow responses
      for (let i = 0; i < 10; i++) {
        monitor.recordOperation('terrible_op', 60000, false, 'Critical error'); // 1 minute response time
      }
      
      const report = monitor.getHealthReport();
      
      expect(report.healthScore).toBeGreaterThanOrEqual(0);
      expect(report.healthScore).toBeLessThanOrEqual(100);
    });

    it('should include process memory usage', () => {
      const report = monitor.getHealthReport();
      
      expect(report.memoryUsage.rss).toBe(50 * 1024 * 1024);
      expect(report.memoryUsage.heapTotal).toBe(30 * 1024 * 1024);
      expect(report.memoryUsage.heapUsed).toBe(20 * 1024 * 1024);
      expect(report.memoryUsage.external).toBe(5 * 1024 * 1024);
      expect(report.memoryUsage.arrayBuffers).toBe(1 * 1024 * 1024);
    });

    it('should track uptime correctly', () => {
      jest.advanceTimersByTime(5000); // 5 seconds
      
      const report = monitor.getHealthReport();
      
      expect(report.uptime).toBe(5000);
    });

    it('should use only recent metrics for health calculation', () => {
      // Add old metrics (should not be considered in health report)
      for (let i = 0; i < 50; i++) {
        monitor.recordOperation('old_op', 5000, false, 'Old error');
      }
      
      // Add recent good metrics
      for (let i = 0; i < 10; i++) {
        monitor.recordOperation('new_op', 100, true);
      }
      
      const report = monitor.getHealthReport();
      
      // Should only consider last 100 operations, so mostly the good ones
      expect(report.errorRate).toBeLessThan(0.5);
      expect(report.healthScore).toBeGreaterThan(50);
    });
  });

  describe('Health Recommendations', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should recommend action for high error rate', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordOperation('error_op', 500, false, 'Network error');
      }
      
      const report = monitor.getHealthReport();
      
      expect(report.recommendations.some(r => 
        r.includes('High error rate') && r.includes('10%')
      )).toBe(true);
    });

    it('should recommend action for slow response times', () => {
      for (let i = 0; i < 3; i++) {
        monitor.recordOperation('slow_op', 5000, true); // Above threshold
      }
      
      const report = monitor.getHealthReport();
      
      expect(report.recommendations.some(r => 
        r.includes('Slow response times') && r.includes('5000ms')
      )).toBe(true);
    });

    it('should recommend action for high memory usage', () => {
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapTotal: 50 * 1024 * 1024,
        heapUsed: 45 * 1024 * 1024, // 90% usage
        external: 5 * 1024 * 1024,
        arrayBuffers: 1 * 1024 * 1024,
      });
      
      const report = monitor.getHealthReport();
      
      expect(report.recommendations.some(r => 
        r.includes('High memory usage') && r.includes('90%')
      )).toBe(true);
    });

    it('should identify frequent error patterns', () => {
      const now = Date.now();
      jest.setSystemTime(now);
      
      // Add recent errors (within 5 minutes)
      for (let i = 0; i < 6; i++) {
        monitor.recordError('pattern_op', 'Network timeout: Connection failed');
      }
      
      const report = monitor.getHealthReport();
      
      expect(report.recommendations.some(r => 
        r.includes('Frequent Network errors')
      )).toBe(true);
    });

    it('should provide positive feedback when operating normally', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordOperation('normal_op', 100, true);
      }
      
      const report = monitor.getHealthReport();
      
      expect(report.recommendations).toContain('SDK operating normally.');
    });

    it('should group error recommendations by error type', () => {
      const now = Date.now();
      jest.setSystemTime(now);
      
      // Different error types
      for (let i = 0; i < 3; i++) {
        monitor.recordError('op', 'Network: Connection failed');
        monitor.recordError('op', 'Validation: Invalid data');
        monitor.recordError('op', 'Network: Timeout occurred');
      }
      
      const report = monitor.getHealthReport();
      
      // Should recommend fixing Network errors (most common)
      expect(report.recommendations.some(r => 
        r.includes('Network errors')
      )).toBe(true);
    });
  });

  describe('Automatic Health Checks', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should perform automatic health checks at intervals', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Add some failing operations to trigger warning
      for (let i = 0; i < 10; i++) {
        monitor.recordOperation('failing_op', 1000, false, 'Error');
      }
      
      // Trigger health check interval
      jest.advanceTimersByTime(60000); // 1 minute
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'SDK health degraded:',
        expect.objectContaining({
          score: expect.any(Number),
          recommendations: expect.any(Array),
        })
      );
      
      consoleSpy.mockRestore();
    });

    it('should not warn for good health scores', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Add successful operations
      for (let i = 0; i < 10; i++) {
        monitor.recordOperation('good_op', 100, true);
      }
      
      jest.advanceTimersByTime(60000);
      
      expect(consoleSpy).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should use custom health check interval', () => {
      monitor.destroy();
      
      const customConfig = { ...defaultConfig, healthCheckInterval: 30000 };
      monitor = new SDKMonitor(customConfig);
      
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Add failing operations
      for (let i = 0; i < 5; i++) {
        monitor.recordOperation('custom_op', 1000, false, 'Error');
      }
      
      // Should trigger at 30 seconds
      jest.advanceTimersByTime(30000);
      
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Configuration Management', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should update configuration', () => {
      const updates = {
        maxMetricsHistory: 200,
        performanceThreshold: 3000,
      };
      
      monitor.updateConfig(updates);
      
      const config = monitor.getConfig();
      expect(config.maxMetricsHistory).toBe(200);
      expect(config.performanceThreshold).toBe(3000);
      expect(config.errorRateThreshold).toBe(0.05); // Should remain unchanged
    });

    it('should affect health calculations after config update', () => {
      monitor.recordOperation('perf_test', 2500, true);
      
      // With threshold of 2000ms, should be penalized
      const report1 = monitor.getHealthReport();
      expect(report1.recommendations.some(r => r.includes('Slow response times'))).toBe(true);
      
      // Update threshold to 3000ms
      monitor.updateConfig({ performanceThreshold: 3000 });
      
      const report2 = monitor.getHealthReport();
      expect(report2.recommendations.some(r => r.includes('Slow response times'))).toBe(false);
    });

    it('should return current configuration', () => {
      const config = monitor.getConfig();
      expect(config).toEqual({
        maxMetricsHistory: 100,
        healthCheckInterval: 60000,
        performanceThreshold: 2000,
        errorRateThreshold: 0.05,
      });
    });
  });

  describe('Cleanup and Destruction', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should clear health check interval on destroy', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      monitor.destroy();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should clear all metrics on destroy', () => {
      monitor.recordOperation('test_op', 100, true);
      
      expect(monitor.getMetrics()).toHaveLength(1);
      
      monitor.destroy();
      
      expect(monitor.getMetrics()).toHaveLength(0);
    });

    it('should handle multiple destroy calls gracefully', () => {
      expect(() => {
        monitor.destroy();
        monitor.destroy();
        monitor.destroy();
      }).not.toThrow();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should handle extremely long operation times', () => {
      const longDuration = Number.MAX_SAFE_INTEGER;
      
      monitor.recordOperation('long_op', longDuration, true);
      
      const metrics = monitor.getMetrics('long_op');
      expect(metrics[0].duration).toBe(longDuration);
    });

    it('should handle negative operation times', () => {
      monitor.recordOperation('negative_op', -100, true);
      
      const metrics = monitor.getMetrics('negative_op');
      expect(metrics[0].duration).toBe(-100);
    });

    it('should handle fractional durations', () => {
      monitor.recordOperation('fraction_op', 123.456, true);
      
      const metrics = monitor.getMetrics('fraction_op');
      expect(metrics[0].duration).toBe(123.456);
    });

    it('should handle special characters in operation types', () => {
      const specialOp = 'op-with/special@chars.test';
      
      monitor.recordOperation(specialOp, 100, true);
      
      const metrics = monitor.getMetrics(specialOp);
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operationType).toBe(specialOp);
    });

    it('should handle very long operation type names', () => {
      const longOpName = 'x'.repeat(1000);
      
      monitor.recordOperation(longOpName, 100, true);
      
      const metrics = monitor.getMetrics(longOpName);
      expect(metrics[0].operationType).toBe(longOpName);
    });

    it('should handle empty operation type names', () => {
      monitor.recordOperation('', 100, true);
      
      const metrics = monitor.getMetrics('');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].operationType).toBe('');
    });

    it('should handle very long error messages', () => {
      const longError = 'Error: ' + 'x'.repeat(10000);
      
      monitor.recordError('error_op', longError);
      
      const metrics = monitor.getMetrics('error_op');
      expect(metrics[0].error).toBe(longError);
    });

    it('should handle undefined and null error messages', () => {
      monitor.recordOperation('null_error', 100, false, undefined);
      monitor.recordOperation('undef_error', 100, false);
      
      const nullMetrics = monitor.getMetrics('null_error');
      const undefMetrics = monitor.getMetrics('undef_error');
      
      expect(nullMetrics[0].error).toBeUndefined();
      expect(undefMetrics[0].error).toBeUndefined();
    });
  });

  describe('Concurrent Operations and Thread Safety', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should handle concurrent metric recording', async () => {
      const promises = [];
      
      // Start many operations concurrently
      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve().then(() => {
            monitor.recordOperation(`concurrent_${i}`, Math.random() * 1000, i % 3 !== 0);
          })
        );
      }
      
      await Promise.all(promises);
      
      const metrics = monitor.getMetrics();
      expect(metrics).toHaveLength(100);
    });

    it('should handle concurrent start/end operations', () => {
      const operations = [];
      
      // Start multiple operations
      for (let i = 0; i < 10; i++) {
        operations.push(monitor.startOperation(`batch_op_${i}`));
      }
      
      // End them in different order
      operations.reverse().forEach((id, index) => {
        jest.advanceTimersByTime(100);
        monitor.endOperation(id, index % 2 === 0);
      });
      
      const metrics = monitor.getMetrics();
      expect(metrics).toHaveLength(10);
    });

    it('should maintain consistency during concurrent access', () => {
      // Record operations while reading stats
      const recordingPromise = Promise.resolve().then(() => {
        for (let i = 0; i < 50; i++) {
          monitor.recordOperation('consistency_test', 100, true);
        }
      });
      
      const readingPromise = Promise.resolve().then(() => {
        for (let i = 0; i < 10; i++) {
          const stats = monitor.getOperationStats('consistency_test');
          const report = monitor.getHealthReport();
          
          // Should never throw or return invalid data
          expect(stats.totalCount).toBeGreaterThanOrEqual(0);
          expect(report.healthScore).toBeGreaterThanOrEqual(0);
          expect(report.healthScore).toBeLessThanOrEqual(100);
        }
      });
      
      return Promise.all([recordingPromise, readingPromise]);
    });
  });

  describe('Node.js Specific Features', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should work with Node.js process memory monitoring', () => {
      const report = monitor.getHealthReport();
      
      // Should include all Node.js memory usage fields
      expect(report.memoryUsage).toHaveProperty('rss');
      expect(report.memoryUsage).toHaveProperty('heapTotal');
      expect(report.memoryUsage).toHaveProperty('heapUsed');
      expect(report.memoryUsage).toHaveProperty('external');
      expect(report.memoryUsage).toHaveProperty('arrayBuffers');
    });

    it('should handle Node.js timer precision', () => {
      const startTime = process.hrtime.bigint();
      
      const operationId = monitor.startOperation('precision_test');
      
      // Use Node.js high-resolution time
      jest.advanceTimersByTime(1000);
      monitor.endOperation(operationId, true);
      
      const metrics = monitor.getMetrics('precision_test');
      expect(metrics[0].duration).toBe(1000);
    });

    it('should work with Node.js timers and intervals', () => {
      // Test that Node.js timer APIs work correctly
      let called = false;
      
      setTimeout(() => {
        called = true;
        monitor.recordOperation('timer_test', 100, true);
      }, 0);
      
      jest.advanceTimersByTime(0);
      
      expect(called).toBe(true);
      expect(monitor.getMetrics('timer_test')).toHaveLength(1);
    });

    it('should handle Node.js process uptime correctly', () => {
      const beforeUptime = Date.now();
      
      jest.advanceTimersByTime(5000);
      
      const report = monitor.getHealthReport();
      const afterUptime = Date.now();
      
      expect(report.uptime).toBeGreaterThanOrEqual(5000);
      expect(report.uptime).toBeLessThanOrEqual(afterUptime - beforeUptime);
    });
  });

  describe('Memory Management', () => {
    beforeEach(() => {
      monitor = new SDKMonitor({
        ...defaultConfig,
        maxMetricsHistory: 10, // Small limit for testing
      });
    });

    it('should not accumulate unlimited metrics', () => {
      // Add many more metrics than the limit
      for (let i = 0; i < 1000; i++) {
        monitor.recordOperation(`memory_test_${i}`, 100, true);
      }
      
      const metrics = monitor.getMetrics();
      expect(metrics.length).toBe(10); // Should be limited
    });

    it('should cleanup old active operations on destroy', () => {
      const id1 = monitor.startOperation('cleanup_test_1');
      const id2 = monitor.startOperation('cleanup_test_2');
      
      // Don't end the operations
      monitor.destroy();
      
      // Should not leak memory or cause issues
      expect(() => monitor.endOperation(id1, true)).not.toThrow();
    });

    it('should handle large numbers of operation types', () => {
      // Create many different operation types
      for (let i = 0; i < 100; i++) {
        monitor.recordOperation(`type_${i}`, 100, true);
      }
      
      // Should handle this without issues
      const report = monitor.getHealthReport();
      expect(report.totalOperations).toBe(100);
    });
  });

  describe('TypeScript Type Safety', () => {
    beforeEach(() => {
      monitor = new SDKMonitor(defaultConfig);
    });

    it('should maintain type safety for configuration', () => {
      const config: MonitorConfig = monitor.getConfig();
      
      expect(typeof config.maxMetricsHistory).toBe('number');
      expect(typeof config.healthCheckInterval).toBe('number');
      expect(typeof config.performanceThreshold).toBe('number');
      expect(typeof config.errorRateThreshold).toBe('number');
    });

    it('should return properly typed health report', () => {
      const report: HealthReport = monitor.getHealthReport();
      
      expect(typeof report.healthScore).toBe('number');
      expect(typeof report.totalOperations).toBe('number');
      expect(typeof report.errorRate).toBe('number');
      expect(typeof report.uptime).toBe('number');
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(typeof report.memoryUsage).toBe('object');
    });

    it('should return properly typed metrics', () => {
      monitor.recordOperation('type_test', 100, true);
      
      const metrics: PerformanceMetric[] = monitor.getMetrics('type_test');
      
      expect(Array.isArray(metrics)).toBe(true);
      expect(typeof metrics[0].operationType).toBe('string');
      expect(typeof metrics[0].startTime).toBe('number');
      expect(typeof metrics[0].duration).toBe('number');
      expect(typeof metrics[0].success).toBe('boolean');
    });

    it('should handle optional metric properties correctly', () => {
      const id = monitor.startOperation('optional_test');
      monitor.endOperation(id, false, 'Test error');
      
      const metrics = monitor.getMetrics('optional_test');
      const metric = metrics[0];
      
      expect(metric.endTime).toBeDefined();
      expect(metric.duration).toBeDefined();
      expect(metric.success).toBe(false);
      expect(metric.error).toBe('Test error');
    });
  });
});