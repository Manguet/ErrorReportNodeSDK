export interface PerformanceMetric {
  operationType: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success?: boolean;
  error?: string;
}

export interface HealthReport {
  healthScore: number;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageResponseTime: number;
  errorRate: number;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
  recommendations: string[];
}

export interface MonitorConfig {
  maxMetricsHistory: number;
  healthCheckInterval: number;
  performanceThreshold: number;
  errorRateThreshold: number;
}

export class SDKMonitor {
  private config: MonitorConfig;
  private performanceMetrics: PerformanceMetric[] = [];
  private activeOperations: Map<string, PerformanceMetric> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private startTime: number = Date.now();

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = {
      maxMetricsHistory: 1000,
      healthCheckInterval: 60000, // 1 minute
      performanceThreshold: 5000, // 5 seconds
      errorRateThreshold: 0.1, // 10%
      ...config,
    };

    this.startHealthChecks();
  }

  startOperation(operationType: string): string {
    const operationId = this.generateOperationId();
    const metric: PerformanceMetric = {
      operationType,
      startTime: Date.now(),
    };

    this.activeOperations.set(operationId, metric);
    return operationId;
  }

  endOperation(operationId: string, success: boolean = true, error?: string): void {
    const metric = this.activeOperations.get(operationId);
    if (!metric) {
      return;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    metric.success = success;
    metric.error = error;

    this.activeOperations.delete(operationId);
    this.addMetric(metric);
  }

  recordOperation(operationType: string, duration: number, success: boolean = true, error?: string): void {
    const metric: PerformanceMetric = {
      operationType,
      startTime: Date.now() - duration,
      endTime: Date.now(),
      duration,
      success,
      error,
    };

    this.addMetric(metric);
  }

  recordError(operationType: string, error: string): void {
    this.recordOperation(operationType, 0, false, error);
  }

  recordSuccess(operationType: string, duration?: number): void {
    this.recordOperation(operationType, duration || 0, true);
  }

  private addMetric(metric: PerformanceMetric): void {
    this.performanceMetrics.push(metric);

    // Maintain max history size
    if (this.performanceMetrics.length > this.config.maxMetricsHistory) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.config.maxMetricsHistory);
    }
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      const report = this.getHealthReport();
      
      if (report.healthScore < 70) {
        console.warn('SDK health degraded:', {
          score: report.healthScore,
          recommendations: report.recommendations,
        });
      }
    }, this.config.healthCheckInterval);
  }

  getHealthReport(): HealthReport {
    const metrics = this.performanceMetrics.slice(-100); // Last 100 operations
    const totalOperations = metrics.length;
    const successfulOperations = metrics.filter(m => m.success).length;
    const failedOperations = totalOperations - successfulOperations;
    
    const errorRate = totalOperations > 0 ? failedOperations / totalOperations : 0;
    
    const avgResponseTime = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + (m.duration || 0), 0) / metrics.length 
      : 0;

    const healthScore = this.calculateHealthScore(errorRate, avgResponseTime);
    const recommendations = this.generateRecommendations(errorRate, avgResponseTime, metrics);

    return {
      healthScore,
      totalOperations,
      successfulOperations,
      failedOperations,
      averageResponseTime: Math.round(avgResponseTime),
      errorRate: Math.round(errorRate * 100) / 100,
      memoryUsage: process.memoryUsage(),
      uptime: Date.now() - this.startTime,
      recommendations,
    };
  }

  private calculateHealthScore(errorRate: number, avgResponseTime: number): number {
    let score = 100;

    // Penalize high error rates
    if (errorRate > this.config.errorRateThreshold) {
      score -= (errorRate - this.config.errorRateThreshold) * 200;
    }

    // Penalize slow response times
    if (avgResponseTime > this.config.performanceThreshold) {
      const slownessPenalty = Math.min(50, (avgResponseTime - this.config.performanceThreshold) / 100);
      score -= slownessPenalty;
    }

    // Penalize high memory usage
    const memUsage = process.memoryUsage();
    const heapUsagePercent = memUsage.heapUsed / memUsage.heapTotal;
    if (heapUsagePercent > 0.8) {
      score -= (heapUsagePercent - 0.8) * 100;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private generateRecommendations(
    errorRate: number, 
    avgResponseTime: number, 
    metrics: PerformanceMetric[]
  ): string[] {
    const recommendations: string[] = [];

    if (errorRate > this.config.errorRateThreshold) {
      recommendations.push(`High error rate (${Math.round(errorRate * 100)}%). Check network connectivity and service availability.`);
    }

    if (avgResponseTime > this.config.performanceThreshold) {
      recommendations.push(`Slow response times (${Math.round(avgResponseTime)}ms). Consider increasing timeout or checking network latency.`);
    }

    const memUsage = process.memoryUsage();
    const heapUsagePercent = memUsage.heapUsed / memUsage.heapTotal;
    if (heapUsagePercent > 0.8) {
      recommendations.push(`High memory usage (${Math.round(heapUsagePercent * 100)}%). Consider reducing batch sizes or implementing memory cleanup.`);
    }

    // Check for specific error patterns
    const recentErrors = metrics.filter(m => !m.success && m.endTime && m.endTime > Date.now() - 300000); // Last 5 minutes
    if (recentErrors.length > 5) {
      const errorTypes = recentErrors.reduce((acc, m) => {
        const errorType = m.error ? m.error.split(':')[0] : 'Unknown';
        acc[errorType] = (acc[errorType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const mostCommonError = Object.entries(errorTypes).sort(([,a], [,b]) => b - a)[0];
      if (mostCommonError) {
        recommendations.push(`Frequent ${mostCommonError[0]} errors (${mostCommonError[1]} in 5 min). Check service configuration.`);
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('SDK operating normally.');
    }

    return recommendations;
  }

  getMetrics(operationType?: string, limit?: number): PerformanceMetric[] {
    let metrics = this.performanceMetrics;

    if (operationType) {
      metrics = metrics.filter(m => m.operationType === operationType);
    }

    if (limit) {
      metrics = metrics.slice(-limit);
    }

    return [...metrics];
  }

  getOperationStats(operationType: string): {
    totalCount: number;
    successCount: number;
    errorCount: number;
    averageDuration: number;
    successRate: number;
  } {
    const metrics = this.performanceMetrics.filter(m => m.operationType === operationType);
    const totalCount = metrics.length;
    const successCount = metrics.filter(m => m.success).length;
    const errorCount = totalCount - successCount;
    
    const avgDuration = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + (m.duration || 0), 0) / metrics.length 
      : 0;
    
    const successRate = totalCount > 0 ? successCount / totalCount : 0;

    return {
      totalCount,
      successCount,
      errorCount,
      averageDuration: Math.round(avgDuration),
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  clearMetrics(): void {
    this.performanceMetrics = [];
    this.activeOperations.clear();
  }

  updateConfig(updates: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): MonitorConfig {
    return { ...this.config };
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.clearMetrics();
  }
}