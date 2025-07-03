"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExpressErrorHandler = createExpressErrorHandler;
exports.createExpressRequestLogger = createExpressRequestLogger;
exports.setupExpressIntegration = setupExpressIntegration;
function createExpressErrorHandler(errorReporter, options = {}) {
    return (error, req, res, next) => {
        var _a;
        if (shouldSkipError(req, options)) {
            return next(error);
        }
        const context = {
            route: (_a = req.route) === null || _a === void 0 ? void 0 : _a.path,
            params: req.params,
            session: req.session ? { id: req.session.id } : undefined,
        };
        errorReporter.captureException(error, context, req).catch(err => {
            errorReporter.handleError(new Error('Failed to capture exception: ' + err.message), { originalError: err, context, req: { url: req.url, method: req.method } });
        });
        next(error);
    };
}
function createExpressRequestLogger(errorReporter, options = {}) {
    return (req, res, next) => {
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
function shouldSkipError(req, options) {
    if (options.skipPaths) {
        return options.skipPaths.some(path => req.path.includes(path));
    }
    return false;
}
function shouldSkipRequest(req, options) {
    if (options.skipHealthChecks && isHealthCheck(req)) {
        return true;
    }
    if (options.skipPaths) {
        return options.skipPaths.some(path => req.path.includes(path));
    }
    return false;
}
function isHealthCheck(req) {
    const healthPaths = ['/health', '/healthz', '/ping', '/status', '/ready', '/alive'];
    return healthPaths.some(path => req.path === path || req.path.endsWith(path));
}
function logRequest(errorReporter, req, res, duration) {
    var _a;
    errorReporter
        .getBreadcrumbManager()
        .addHttpRequest(req.method, req.originalUrl || req.url, res.statusCode);
    if (res.statusCode >= 400) {
        const error = new Error(`HTTP ${res.statusCode}: ${req.method} ${req.originalUrl || req.url}`);
        error.name = 'HttpError';
        const context = {
            http_status: res.statusCode,
            request_duration: duration,
            route: (_a = req.route) === null || _a === void 0 ? void 0 : _a.path,
            params: req.params,
        };
        errorReporter.captureException(error, context, req).catch(err => {
            errorReporter.handleError(new Error('Failed to capture HTTP error: ' + err.message), { originalError: err, context, req: { url: req.url, method: req.method } });
        });
    }
}
function setupExpressIntegration(app, errorReporter, options = {}) {
    app.use(createExpressRequestLogger(errorReporter, options));
    app.use(createExpressErrorHandler(errorReporter, options));
    setupProcessHandlers(errorReporter);
}
function setupProcessHandlers(errorReporter) {
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        errorReporter.captureException(error, { type: 'uncaughtException' }).finally(() => {
            process.exit(1);
        });
    });
    process.on('unhandledRejection', (reason, promise) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        error.name = 'UnhandledPromiseRejection';
        console.error('Unhandled Rejection:', error);
        errorReporter
            .captureException(error, {
            type: 'unhandledRejection',
            promise: promise.toString(),
        })
            .catch(err => {
            errorReporter.handleError(new Error('Failed to capture unhandled rejection: ' + err.message), { originalError: err, reason, promise: promise.toString() });
        });
    });
}
//# sourceMappingURL=express.js.map