import { ErrorReporter } from '../../src/services/ErrorReporter';
import axios from 'axios';
import { ErrorExplorerConfig } from '../../src/types';
import { exec } from 'child_process';

jest.mock('axios');
jest.mock('child_process');

const mockedExec = exec as jest.MockedFunction<typeof exec>;

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ErrorReporter', () => {
  let errorReporter: ErrorReporter;
  let mockAxiosInstance: any;

  const defaultConfig: ErrorExplorerConfig = {
    webhookUrl: 'https://test.error-explorer.com',
    projectName: 'test-project',
    environment: 'test',
    enabled: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock axios instance
    mockAxiosInstance = {
      post: jest.fn().mockResolvedValue({ data: { success: true } }),
    };
    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    // Mock child_process exec
    mockedExec.mockImplementation(((command: string, options: any, callback: any) => {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      // Simulate successful git command
      callback(null, { stdout: 'abc123def456\n', stderr: '' });
    }) as any);

    errorReporter = new ErrorReporter(defaultConfig);
  });

  afterEach(() => {
    if (errorReporter) {
      errorReporter.destroy();
    }
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      const config = errorReporter.getConfig();
      expect(config.webhookUrl).toBe(defaultConfig.webhookUrl);
      expect(config.projectName).toBe(defaultConfig.projectName);
      expect(config.environment).toBe(defaultConfig.environment);
      expect(config.enabled).toBe(true);
    });

    it('should create axios instance with correct timeout', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 5000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });

  describe('captureException', () => {
    it('should send error data to webhook', async () => {
      const error = new Error('Test error');

      await errorReporter.captureException(error);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        defaultConfig.webhookUrl,
        expect.objectContaining({
          message: 'Test error',
          exception_class: 'Error',
          project: defaultConfig.projectName,
          environment: defaultConfig.environment,
          timestamp: expect.any(String),
          server: expect.any(Object),
          breadcrumbs: expect.any(Array),
        })
      );
    });

    it('should include context when provided', async () => {
      const error = new Error('Test error');
      const context = { userId: '123', action: 'test-action' };

      await errorReporter.captureException(error, context);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          context,
        })
      );
    });

    it('should not send when disabled', async () => {
      const disabledReporter = new ErrorReporter({ ...defaultConfig, enabled: false });
      const error = new Error('Test error');

      await disabledReporter.captureException(error);

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should handle request context from Express', async () => {
      const error = new Error('Test error');
      const mockRequest = {
        url: '/test',
        method: 'GET',
        headers: { 'user-agent': 'test-agent' },
        query: { param: 'value' },
        res: { statusCode: 500 },
      };

      await errorReporter.captureException(error, {}, mockRequest);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          request: expect.objectContaining({
            url: '/test',
            method: 'GET',
            headers: expect.objectContaining({
              'user-agent': 'test-agent',
            }),
            query: { param: 'value' },
          }),
          http_status: 500,
        })
      );
    });
  });

  describe('captureMessage', () => {
    it('should capture message as error', async () => {
      await errorReporter.captureMessage('Test message', 'warning');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: 'Test message',
          exception_class: 'Error', // The actual implementation uses Error, not CapturedMessage
          context: expect.objectContaining({
            level: 'warning',
          }),
        })
      );
    });
  });

  describe('addBreadcrumb', () => {
    it('should add breadcrumb to manager', () => {
      errorReporter.addBreadcrumb('Test breadcrumb', 'navigation', 'info');

      const breadcrumbManager = errorReporter.getBreadcrumbManager();
      const breadcrumbs = breadcrumbManager.getBreadcrumbs();

      expect(breadcrumbs).toHaveLength(1);
      expect(breadcrumbs[0]).toMatchObject({
        message: 'Test breadcrumb',
        category: 'navigation',
        level: 'info',
      });
    });
  });

  describe('setUser', () => {
    it('should set user context', async () => {
      const user = { id: '123', email: 'test@example.com' };
      errorReporter.setUser(user);

      const error = new Error('Test error');
      await errorReporter.captureException(error);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          user,
        })
      );
    });
  });

  describe('error handling', () => {
    it('should not throw on axios failures', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      const error = new Error('Test error');

      await expect(errorReporter.captureException(error)).resolves.not.toThrow();
      expect(mockAxiosInstance.post).toHaveBeenCalled();
    });

    it('should handle successful sending', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { success: true } });

      const error = new Error('Test error');
      await errorReporter.captureException(error);

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom error callbacks', () => {
    it('should use custom onError callback', async () => {
      const onError = jest.fn();
      const onWarning = jest.fn();

      const customErrorReporter = new ErrorReporter({
        ...defaultConfig,
        onError,
        onWarning,
      });

      // Trigger error by making axios fail
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      const error = new Error('Test error');
      await customErrorReporter.captureException(error);

      expect(onWarning).toHaveBeenCalledWith(
        'Failed to send error, queued for later',
        expect.objectContaining({
          error: 'Network error'
        })
      );

      customErrorReporter.destroy();
    });

    it('should use custom onWarning callback for rate limiting', async () => {
      const onError = jest.fn();
      const onWarning = jest.fn();

      // Make axios fail to create failed requests that count towards rate limit
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      const customErrorReporter = new ErrorReporter({
        ...defaultConfig,
        onError,
        onWarning,
        enableRateLimit: true,
        maxRequestsPerMinute: 1,
      });

      const error = new Error('Test error');
      
      // First call should fail and be queued
      await customErrorReporter.captureException(error);
      
      // Second call should be rate limited because we already have 1 failed request
      await customErrorReporter.captureException(error);

      expect(onWarning).toHaveBeenCalledWith(
        'Rate limited, queued for later sending',
        expect.objectContaining({
          errorData: expect.any(Object)
        })
      );

      customErrorReporter.destroy();
    });

    it('should fall back to console methods when no callbacks provided', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      errorReporter.handleWarning('Test warning', { test: true });
      
      expect(consoleSpy).toHaveBeenCalledWith('ErrorExplorer:', 'Test warning', { test: true });
      
      consoleSpy.mockRestore();
    });

    it('should provide access to handleError and handleWarning methods', () => {
      const onError = jest.fn();
      const onWarning = jest.fn();

      const customErrorReporter = new ErrorReporter({
        ...defaultConfig,
        onError,
        onWarning,
      });

      const testError = new Error('Test error');
      const testContext = { test: true };

      customErrorReporter.handleError(testError, testContext);
      customErrorReporter.handleWarning('Test warning', testContext);

      expect(onError).toHaveBeenCalledWith(testError, testContext);
      expect(onWarning).toHaveBeenCalledWith('Test warning', testContext);

      customErrorReporter.destroy();
    });
  });
});
