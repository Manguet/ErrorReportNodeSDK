import { EnhancedErrorReporter } from '../../src/services/EnhancedErrorReporter';
import { QuotaManager } from '../../src/services/QuotaManager';
import { RetryManager } from '../../src/services/RetryManager';
import { SDKMonitor } from '../../src/services/SDKMonitor';
import { SecurityValidator } from '../../src/services/SecurityValidator';
import { BatchManager } from '../../src/services/BatchManager';
import { CompressionService } from '../../src/services/CompressionService';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock services
jest.mock('../../src/services/QuotaManager');
jest.mock('../../src/services/RetryManager');
jest.mock('../../src/services/SDKMonitor');
jest.mock('../../src/services/SecurityValidator');
jest.mock('../../src/services/BatchManager');
jest.mock('../../src/services/CompressionService');

describe('EnhancedErrorReporter', () => {
  let errorReporter: EnhancedErrorReporter;
  let mockAxiosInstance: jest.Mocked<any>;

  const defaultConfig = {
    webhookUrl: 'https://api.error-explorer.com/webhook',
    projectName: 'test-project',
    environment: 'test',
    quota: {
      dailyLimit: 100,
      monthlyLimit: 1000,
    },
    retry: {
      maxAttempts: 3,
    },
    security: {
      requireHttps: true,
    },
    batch: {
      enabled: true,
      batchSize: 5,
    },
    compression: {
      enabled: true,
      threshold: 1024,
    },
    monitoring: {
      enabled: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockAxiosInstance = {
      post: jest.fn().mockResolvedValue({ status: 200, statusText: 'OK' }),
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    errorReporter = new EnhancedErrorReporter(defaultConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
    errorReporter.destroy();
  });

  describe('initialization', () => {
    it('should create enhanced error reporter with all services', () => {
      expect(errorReporter).toBeDefined();
      expect(QuotaManager).toHaveBeenCalledWith(defaultConfig.quota);
      expect(RetryManager).toHaveBeenCalledWith(defaultConfig.retry);
      expect(SecurityValidator).toHaveBeenCalledWith(defaultConfig.security);
      expect(BatchManager).toHaveBeenCalledWith({
        batchSize: 5,
        batchTimeout: 5000,
        maxPayloadSize: undefined,
      });
      expect(CompressionService).toHaveBeenCalledWith({
        threshold: 1024,
        level: 6,
      });
      expect(SDKMonitor).toHaveBeenCalledWith({
        healthCheckInterval: 60000,
        performanceThreshold: 5000,
      });
    });

    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ErrorExplorer-NodeJS-Enhanced/2.0.0',
        },
      });
    });

    it('should initialize without optional services when disabled', () => {
      const minimalConfig = {
        webhookUrl: 'https://api.error-explorer.com/webhook',
        projectName: 'test-project',
      };

      const minimalReporter = new EnhancedErrorReporter(minimalConfig);
      expect(minimalReporter).toBeDefined();
    });
  });

  describe('reportError', () => {
    it('should report error successfully with all services', async () => {
      const error = new Error('Test error');
      const context = { userId: 123 };

      // Mock service responses
      const mockQuotaManager = QuotaManager.prototype;
      (mockQuotaManager.canSendError as jest.Mock).mockReturnValue({
        allowed: true,
        quotaStats: {},
      });

      const mockSecurityValidator = SecurityValidator.prototype;
      (mockSecurityValidator.validateErrorData as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: [],
      });
      (mockSecurityValidator.sanitizeSensitiveData as jest.Mock).mockImplementation(data => data);

      await errorReporter.reportError(error, context);

      // Verify security validation was called
      expect(mockSecurityValidator.validateErrorData).toHaveBeenCalled();
      expect(mockSecurityValidator.sanitizeSensitiveData).toHaveBeenCalled();

      // Verify quota check was performed
      expect(mockQuotaManager.canSendError).toHaveBeenCalled();
      expect(mockQuotaManager.recordUsage).toHaveBeenCalled();
    });

    it('should handle security validation failure', async () => {
      const error = new Error('Test error');

      const mockSecurityValidator = SecurityValidator.prototype;
      (mockSecurityValidator.validateErrorData as jest.Mock).mockReturnValue({
        valid: false,
        errors: ['Invalid data'],
        warnings: [],
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await errorReporter.reportError(error);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error data validation failed:',
        ['Invalid data']
      );
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle quota exceeded', async () => {
      const error = new Error('Test error');

      const mockQuotaManager = QuotaManager.prototype;
      (mockQuotaManager.canSendError as jest.Mock).mockReturnValue({
        allowed: false,
        reason: 'Daily limit exceeded',
        quotaStats: {},
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await errorReporter.reportError(error);

      expect(consoleSpy).toHaveBeenCalledWith('Quota exceeded:', 'Daily limit exceeded');
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle rate limiting', async () => {
      const error = new Error('Test error');

      // Mock rate limiter to deny request
      const mockRateLimiter = require('../../src/services/RateLimiter').RateLimiter.prototype;
      mockRateLimiter.isAllowed = jest.fn().mockReturnValue(false);

      const mockQuotaManager = QuotaManager.prototype;
      (mockQuotaManager.canSendError as jest.Mock).mockReturnValue({
        allowed: true,
        quotaStats: {},
      });

      await errorReporter.reportError(error);

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should use compression for large payloads', async () => {
      const error = new Error('Test error');

      const mockQuotaManager = QuotaManager.prototype;
      (mockQuotaManager.canSendError as jest.Mock).mockReturnValue({
        allowed: true,
        quotaStats: {},
      });

      const mockCompressionService = CompressionService.prototype;
      (mockCompressionService.shouldCompress as jest.Mock).mockReturnValue(true);
      (mockCompressionService.compress as jest.Mock).mockResolvedValue('compressed-data');

      await errorReporter.reportError(error);

      expect(mockCompressionService.shouldCompress).toHaveBeenCalled();
      expect(mockCompressionService.compress).toHaveBeenCalled();
    });

    it('should use batch manager when enabled', async () => {
      const error = new Error('Test error');

      const mockQuotaManager = QuotaManager.prototype;
      (mockQuotaManager.canSendError as jest.Mock).mockReturnValue({
        allowed: true,
        quotaStats: {},
      });

      const mockBatchManager = BatchManager.prototype;
      (mockBatchManager.addToBatch as jest.Mock).mockImplementation(() => {});

      await errorReporter.reportError(error);

      expect(mockBatchManager.addToBatch).toHaveBeenCalled();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled(); // Should not send directly
    });

    it('should handle reporting disabled', async () => {
      const disabledReporter = new EnhancedErrorReporter({
        ...defaultConfig,
        enabled: false,
      });

      const error = new Error('Test error');
      await disabledReporter.reportError(error);

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should fallback to offline queue on error', async () => {
      const error = new Error('Test error');
      const networkError = new Error('Network error');

      mockAxiosInstance.post.mockRejectedValue(networkError);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await errorReporter.reportError(error);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error reporting failed, added to offline queue:',
        'Network error'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('utility methods', () => {
    it('should flush batch and offline queue', async () => {
      const mockBatchManager = BatchManager.prototype;
      (mockBatchManager.flush as jest.Mock).mockResolvedValue(undefined);

      const mockOfflineQueue = require('../../src/services/OfflineQueue').OfflineQueue.prototype;
      mockOfflineQueue.flush = jest.fn().mockResolvedValue(undefined);

      await errorReporter.flush();

      expect(mockBatchManager.flush).toHaveBeenCalled();
      expect(mockOfflineQueue.flush).toHaveBeenCalled();
    });

    it('should return comprehensive stats', () => {
      const mockBatchManager = BatchManager.prototype;
      (mockBatchManager.getStats as jest.Mock).mockReturnValue({
        currentSize: 0,
        totalBatches: 5,
      });

      const mockQuotaManager = QuotaManager.prototype;
      (mockQuotaManager.getStats as jest.Mock).mockReturnValue({
        dailyUsage: 10,
        dailyRemaining: 90,
      });

      const stats = errorReporter.getStats();

      expect(stats).toBeDefined();
      expect(stats.batch).toEqual({
        currentSize: 0,
        totalBatches: 5,
      });
      expect(stats.quota).toEqual({
        dailyUsage: 10,
        dailyRemaining: 90,
      });
    });

    it('should return health report', () => {
      const mockSDKMonitor = SDKMonitor.prototype;
      (mockSDKMonitor.getHealthReport as jest.Mock).mockReturnValue({
        healthScore: 85,
        totalOperations: 100,
      });

      const healthReport = errorReporter.getHealthReport();

      expect(healthReport).toEqual({
        healthScore: 85,
        totalOperations: 100,
      });
    });

    it('should update configuration', () => {
      const updates = {
        quota: { dailyLimit: 200 },
        compression: { threshold: 2048 },
      };

      errorReporter.updateConfig(updates);

      const mockQuotaManager = QuotaManager.prototype;
      expect(mockQuotaManager.updateConfig).toHaveBeenCalledWith({ dailyLimit: 200 });

      const mockCompressionService = CompressionService.prototype;
      expect(mockCompressionService.updateConfig).toHaveBeenCalledWith({ threshold: 2048 });
    });
  });

  describe('connection testing', () => {
    it('should test connection successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({ status: 200 });

      const result = await errorReporter.testConnection();

      expect(result.success).toBe(true);
      expect(result.responseTime).toBeGreaterThan(0);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        'https://api.error-explorer.com/webhook',
        expect.objectContaining({
          test: true,
          message: 'Connection test from Enhanced Node.js SDK',
        })
      );
    });

    it('should handle connection test failure', async () => {
      const networkError = new Error('Connection refused');
      mockAxiosInstance.post.mockRejectedValue(networkError);

      const result = await errorReporter.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('configuration validation', () => {
    it('should validate configuration with security validator', () => {
      const mockSecurityValidator = SecurityValidator.prototype;
      (mockSecurityValidator.validateConfiguration as jest.Mock).mockReturnValue({
        valid: true,
        errors: [],
        warnings: ['HTTPS recommended'],
      });

      const result = errorReporter.validateConfiguration();

      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual(['HTTPS recommended']);
    });

    it('should validate configuration without security validator', () => {
      const basicReporter = new EnhancedErrorReporter({
        webhookUrl: 'https://api.error-explorer.com/webhook',
        projectName: 'test-project',
      });

      const result = basicReporter.validateConfiguration();

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect missing required configuration', () => {
      const invalidReporter = new EnhancedErrorReporter({
        webhookUrl: '',
        projectName: '',
      });

      const result = invalidReporter.validateConfiguration();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Webhook URL is required');
      expect(result.errors).toContain('Project name is required');
    });
  });

  describe('breadcrumb methods', () => {
    it('should delegate breadcrumb methods correctly', () => {
      const mockBreadcrumbManager = require('../../src/services/BreadcrumbManager').BreadcrumbManager.prototype;
      mockBreadcrumbManager.addBreadcrumb = jest.fn();
      mockBreadcrumbManager.logNavigation = jest.fn();
      mockBreadcrumbManager.logUserAction = jest.fn();
      mockBreadcrumbManager.logHttpRequest = jest.fn();
      mockBreadcrumbManager.clearBreadcrumbs = jest.fn();

      errorReporter.addBreadcrumb('test message', 'test', 'info', { key: 'value' });
      errorReporter.logNavigation('/home', '/profile');
      errorReporter.logUserAction('click_button', { button: 'submit' });
      errorReporter.logHttpRequest('GET', '/api/users', 200);
      errorReporter.clearBreadcrumbs();

      expect(mockBreadcrumbManager.addBreadcrumb).toHaveBeenCalledWith(
        'test message',
        'test',
        'info',
        { key: 'value' }
      );
      expect(mockBreadcrumbManager.logNavigation).toHaveBeenCalledWith('/home', '/profile');
      expect(mockBreadcrumbManager.logUserAction).toHaveBeenCalledWith('click_button', { button: 'submit' });
      expect(mockBreadcrumbManager.logHttpRequest).toHaveBeenCalledWith('GET', '/api/users', 200);
      expect(mockBreadcrumbManager.clearBreadcrumbs).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should destroy all services properly', () => {
      const mockQuotaManager = QuotaManager.prototype;
      const mockSDKMonitor = SDKMonitor.prototype;
      const mockBatchManager = BatchManager.prototype;

      (mockQuotaManager.destroy as jest.Mock) = jest.fn();
      (mockSDKMonitor.destroy as jest.Mock) = jest.fn();
      (mockBatchManager.destroy as jest.Mock) = jest.fn();

      errorReporter.destroy();

      expect(mockQuotaManager.destroy).toHaveBeenCalled();
      expect(mockSDKMonitor.destroy).toHaveBeenCalled();
      expect(mockBatchManager.destroy).toHaveBeenCalled();
    });
  });
});