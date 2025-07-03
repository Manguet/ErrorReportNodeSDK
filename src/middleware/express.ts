import { Request, Response, NextFunction } from 'express';
import { ErrorReporter } from '../services/ErrorReporter';
import { ExpressOptions } from '../types';

export function createExpressErrorHandler(
  errorReporter: ErrorReporter,
  options: ExpressOptions = {}
) {
  return (error: Error, req: Request, res: Response, next: NextFunction) => {
    if (shouldSkipError(req, options)) {
      return next(error);
    }

    const context = {
      route: req.route?.path,
      params: req.params,
      session: (req as any).session ? { id: (req as any).session.id } : undefined,
    };

    errorReporter.captureException(error, context, req).catch(err => {
      errorReporter.handleError(
        new Error('Failed to capture exception: ' + err.message),
        { originalError: err, context, req: { url: req.url, method: req.method } }
      );
    });

    next(error);
  };
}

export function createExpressRequestLogger(
  errorReporter: ErrorReporter,
  options: ExpressOptions = {}
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (shouldSkipRequest(req, options)) {
      return next();
    }

    const startTime = Date.now();
    const originalSend = res.send;
    const originalJson = res.json;

    res.send = function (body) {
      const duration = Date.now() - startTime;
      logRequest(errorReporter, req, res, duration);
      return originalSend.call(this, body);
    };

    res.json = function (body) {
      const duration = Date.now() - startTime;
      logRequest(errorReporter, req, res, duration);
      return originalJson.call(this, body);
    };

    next();
  };
}

function shouldSkipError(req: Request, options: ExpressOptions): boolean {
  if (options.skipPaths) {
    return options.skipPaths.some(path => req.path.includes(path));
  }
  return false;
}

function shouldSkipRequest(req: Request, options: ExpressOptions): boolean {
  if (options.skipHealthChecks && isHealthCheck(req)) {
    return true;
  }

  if (options.skipPaths) {
    return options.skipPaths.some(path => req.path.includes(path));
  }

  return false;
}

function isHealthCheck(req: Request): boolean {
  const healthPaths = ['/health', '/healthz', '/ping', '/status', '/ready', '/alive'];
  return healthPaths.some(path => req.path === path || req.path.endsWith(path));
}

function logRequest(
  errorReporter: ErrorReporter,
  req: Request,
  res: Response,
  duration: number
): void {
  errorReporter
    .getBreadcrumbManager()
    .addHttpRequest(req.method, req.originalUrl || req.url, res.statusCode);

  if (res.statusCode >= 400) {
    const error = new Error(`HTTP ${res.statusCode}: ${req.method} ${req.originalUrl || req.url}`);
    error.name = 'HttpError';

    const context = {
      http_status: res.statusCode,
      request_duration: duration,
      route: req.route?.path,
      params: req.params,
    };

    errorReporter.captureException(error, context, req).catch(err => {
      errorReporter.handleError(
        new Error('Failed to capture HTTP error: ' + err.message),
        { originalError: err, context, req: { url: req.url, method: req.method } }
      );
    });
  }
}

export function setupExpressIntegration(
  app: any,
  errorReporter: ErrorReporter,
  options: ExpressOptions = {}
) {
  app.use(createExpressRequestLogger(errorReporter, options));

  app.use(createExpressErrorHandler(errorReporter, options));

  setupProcessHandlers(errorReporter);
}

function setupProcessHandlers(errorReporter: ErrorReporter): void {
  process.on('uncaughtException', (error: Error) => {
    console.error('Uncaught Exception:', error);
    errorReporter.captureException(error, { type: 'uncaughtException' }).finally(() => {
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    error.name = 'UnhandledPromiseRejection';

    console.error('Unhandled Rejection:', error);
    errorReporter
      .captureException(error, {
        type: 'unhandledRejection',
        promise: promise.toString(),
      })
      .catch(err => {
        errorReporter.handleError(
          new Error('Failed to capture unhandled rejection: ' + err.message),
          { originalError: err, reason, promise: promise.toString() }
        );
      });
  });
}
