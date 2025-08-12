"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupExpressIntegration = exports.createExpressRequestLogger = exports.createExpressErrorHandler = exports.CompressionService = exports.BatchManager = exports.SecurityValidator = exports.SDKMonitor = exports.RetryManager = exports.QuotaManager = exports.RateLimiter = exports.OfflineQueue = exports.CircuitBreaker = exports.BreadcrumbManager = exports.ErrorReporter = exports.ErrorExplorer = void 0;
exports.captureException = captureException;
exports.captureMessage = captureMessage;
exports.addBreadcrumb = addBreadcrumb;
exports.setUser = setUser;
exports.setupExpress = setupExpress;
const ErrorReporter_1 = require("./services/ErrorReporter");
Object.defineProperty(exports, "ErrorReporter", { enumerable: true, get: function () { return ErrorReporter_1.ErrorReporter; } });
const BreadcrumbManager_1 = require("./services/BreadcrumbManager");
Object.defineProperty(exports, "BreadcrumbManager", { enumerable: true, get: function () { return BreadcrumbManager_1.BreadcrumbManager; } });
const CircuitBreaker_1 = require("./services/CircuitBreaker");
Object.defineProperty(exports, "CircuitBreaker", { enumerable: true, get: function () { return CircuitBreaker_1.CircuitBreaker; } });
const OfflineQueue_1 = require("./services/OfflineQueue");
Object.defineProperty(exports, "OfflineQueue", { enumerable: true, get: function () { return OfflineQueue_1.OfflineQueue; } });
const RateLimiter_1 = require("./services/RateLimiter");
Object.defineProperty(exports, "RateLimiter", { enumerable: true, get: function () { return RateLimiter_1.RateLimiter; } });
const QuotaManager_1 = require("./services/QuotaManager");
Object.defineProperty(exports, "QuotaManager", { enumerable: true, get: function () { return QuotaManager_1.QuotaManager; } });
const RetryManager_1 = require("./services/RetryManager");
Object.defineProperty(exports, "RetryManager", { enumerable: true, get: function () { return RetryManager_1.RetryManager; } });
const SDKMonitor_1 = require("./services/SDKMonitor");
Object.defineProperty(exports, "SDKMonitor", { enumerable: true, get: function () { return SDKMonitor_1.SDKMonitor; } });
const SecurityValidator_1 = require("./services/SecurityValidator");
Object.defineProperty(exports, "SecurityValidator", { enumerable: true, get: function () { return SecurityValidator_1.SecurityValidator; } });
const BatchManager_1 = require("./services/BatchManager");
Object.defineProperty(exports, "BatchManager", { enumerable: true, get: function () { return BatchManager_1.BatchManager; } });
const CompressionService_1 = require("./services/CompressionService");
Object.defineProperty(exports, "CompressionService", { enumerable: true, get: function () { return CompressionService_1.CompressionService; } });
const express_1 = require("./middleware/express");
Object.defineProperty(exports, "createExpressErrorHandler", { enumerable: true, get: function () { return express_1.createExpressErrorHandler; } });
Object.defineProperty(exports, "createExpressRequestLogger", { enumerable: true, get: function () { return express_1.createExpressRequestLogger; } });
Object.defineProperty(exports, "setupExpressIntegration", { enumerable: true, get: function () { return express_1.setupExpressIntegration; } });
let _globalErrorReporter = null;
class ErrorExplorer {
    static init(config) {
        ErrorExplorer.instance = new ErrorReporter_1.ErrorReporter(config);
        _globalErrorReporter = ErrorExplorer.instance;
        return ErrorExplorer.instance;
    }
    static configure(config) {
        return ErrorExplorer.init(config);
    }
    static getInstance() {
        return ErrorExplorer.instance;
    }
    static captureException(error, context) {
        if (!ErrorExplorer.instance) {
            console.warn('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
            return Promise.resolve();
        }
        return ErrorExplorer.instance.captureException(error, context);
    }
    static captureMessage(message, level = 'info', context) {
        if (!ErrorExplorer.instance) {
            console.warn('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
            return Promise.resolve();
        }
        return ErrorExplorer.instance.captureMessage(message, level, context);
    }
    static addBreadcrumb(message, category, level, data) {
        if (!ErrorExplorer.instance) {
            console.warn('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
            return;
        }
        ErrorExplorer.instance.addBreadcrumb(message, category, level, data);
    }
    static setUser(user) {
        if (!ErrorExplorer.instance) {
            console.warn('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
            return;
        }
        ErrorExplorer.instance.setUser(user);
    }
    static setupExpress(app, options) {
        if (!ErrorExplorer.instance) {
            throw new Error('ErrorExplorer: Not initialized. Call ErrorExplorer.init() first.');
        }
        (0, express_1.setupExpressIntegration)(app, ErrorExplorer.instance, options);
    }
}
exports.ErrorExplorer = ErrorExplorer;
ErrorExplorer.instance = null;
function captureException(error, context) {
    return ErrorExplorer.captureException(error, context);
}
function captureMessage(message, level = 'info', context) {
    return ErrorExplorer.captureMessage(message, level, context);
}
function addBreadcrumb(message, category, level, data) {
    return ErrorExplorer.addBreadcrumb(message, category, level, data);
}
function setUser(user) {
    return ErrorExplorer.setUser(user);
}
function setupExpress(app, options) {
    return ErrorExplorer.setupExpress(app, options);
}
exports.default = ErrorExplorer;
//# sourceMappingURL=index.js.map