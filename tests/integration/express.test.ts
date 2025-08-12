import express from 'express';
import request from 'supertest';
import {
  createExpressErrorHandler,
  createExpressRequestLogger,
} from '../../src/middleware/express';
import { ErrorReporter } from '../../src/services/ErrorReporter';
import axios from 'axios';

jest.mock('axios');
jest.mock('child_process');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe.skip('Express Integration', () => {
  let app: express.Application;
  let errorReporter: ErrorReporter;
  let mockAxiosInstance: any;

  beforeEach(() => {
    app = express();
    jest.clearAllMocks();

    // Mock axios instance
    mockAxiosInstance = {
      post: jest.fn().mockResolvedValue({ data: { success: true } }),
    };
    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    errorReporter = new ErrorReporter({
      webhookUrl: 'https://error-explorer.com',
      projectName: 'express-test',
      environment: 'test',
      enabled: true,
    });
  });

  describe('Express Error Handler', () => {
    it('should capture and report errors', async () => {
      const testError = new Error('Test error');

      app.get('/error', (_req, _res) => {
        throw testError;
      });

      app.use(createExpressErrorHandler(errorReporter));
      app.use((err: Error, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: 'Internal Server Error' });
      });

      await request(app).get('/error').expect(500);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        'https://test.error-explorer.com',
        expect.objectContaining({
          message: 'Test error',
          exception_class: 'Error',
          project: 'express-test',
          request: expect.objectContaining({
            method: 'GET',
            url: '/error',
          }),
        })
      );
    });

    it('should capture async errors', async () => {
      app.get('/async-error', async (_req, _res, next) => {
        try {
          await Promise.reject(new Error('Async error'));
        } catch (error) {
          next(error);
        }
      });

      app.use(createExpressErrorHandler(errorReporter));
      app.use((err: Error, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: 'Internal Server Error' });
      });

      await request(app).get('/async-error').expect(500);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: 'Async error',
        })
      );
    });

    it('should include request context in error report', async () => {
      app.get('/detailed-error/:id', (_req, _res) => {
        throw new Error('Detailed error');
      });

      app.use(createExpressErrorHandler(errorReporter));
      app.use((err: Error, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: 'Internal Server Error' });
      });

      await request(app)
        .get('/detailed-error/123?query=test')
        .set('User-Agent', 'Test-Agent')
        .expect(500);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          request: expect.objectContaining({
            method: 'GET',
            url: expect.stringContaining('/detailed-error/123'),
            headers: expect.objectContaining({
              'user-agent': 'Test-Agent',
            }),
            query: { query: 'test' },
          }),
          context: expect.objectContaining({
            params: { id: '123' },
          }),
        })
      );
    });

    it('should not report when disabled', async () => {
      const disabledReporter = new ErrorReporter({
        webhookUrl: 'https://error-explorer.com',
        projectName: 'express-test',
        environment: 'test',
        enabled: false,
      });

      app.get('/disabled-error', (_req, _res) => {
        throw new Error('Should not be sent');
      });

      app.use(createExpressErrorHandler(disabledReporter));
      app.use((err: Error, _req: any, res: any, _next: any) => {
        // eslint-disable-line @typescript-eslint/no-unused-vars
        res.status(500).json({ error: 'Internal Server Error' });
      });

      await request(app).get('/disabled-error').expect(500);

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('Express Request Logger', () => {
    it('should log HTTP requests as breadcrumbs', async () => {
      app.use(createExpressRequestLogger(errorReporter));

      app.get('/success', (_req, res) => {
        res.json({ success: true });
      });

      await request(app).get('/success').expect(200);

      const breadcrumbs = errorReporter.getBreadcrumbManager().getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(1);
      expect(breadcrumbs[0]).toMatchObject({
        message: 'GET /success → 200',
        category: 'http',
        level: 'info',
      });
    });

    it('should capture HTTP errors automatically', async () => {
      app.use(createExpressRequestLogger(errorReporter));

      app.get('/not-found', (_req, res) => {
        res.status(404).json({ error: 'Not found' });
      });

      await request(app).get('/not-found').expect(404);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: 'HTTP 404: GET /not-found',
          exception_class: 'HttpError',
          context: expect.objectContaining({
            http_status: 404,
          }),
        })
      );
    });

    it('should skip health check endpoints', async () => {
      app.use(createExpressRequestLogger(errorReporter, { skipHealthChecks: true }));

      app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
      });

      await request(app).get('/health').expect(200);

      const breadcrumbs = errorReporter.getBreadcrumbManager().getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(0);
    });

    it('should skip configured paths', async () => {
      app.use(createExpressRequestLogger(errorReporter, { skipPaths: ['/admin'] }));

      app.get('/admin/dashboard', (_req, res) => {
        res.json({ data: 'admin' });
      });

      await request(app).get('/admin/dashboard').expect(200);

      const breadcrumbs = errorReporter.getBreadcrumbManager().getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(0);
    });
  });

  describe('Error handling in middleware', () => {
    it('should handle middleware failures gracefully', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      app.get('/network-error', (_req, _res) => {
        throw new Error('Test error');
      });

      app.use(createExpressErrorHandler(errorReporter));
      app.use((err: Error, _req: any, res: any, _next: any) => {
        res.status(500).json({ error: 'Internal Server Error' });
      });

      await request(app).get('/network-error').expect(500);

      // Should still attempt to send the error
      expect(mockAxiosInstance.post).toHaveBeenCalled();
    });
  });
});
