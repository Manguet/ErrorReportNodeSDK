"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorReporter = void 0;
const axios_1 = __importDefault(require("axios"));
const BreadcrumbManager_1 = require("./BreadcrumbManager");
const OfflineQueue_1 = require("./OfflineQueue");
const CircuitBreaker_1 = require("./CircuitBreaker");
const RateLimiter_1 = require("./RateLimiter");
const os = __importStar(require("os"));
const process = __importStar(require("process"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class ErrorReporter {
    constructor(config) {
        this.userContext = {};
        this.commitHash = null;
        this.queueProcessingInterval = null;
        this.config = {
            environment: 'production',
            enabled: true,
            maxBreadcrumbs: 50,
            timeout: 5000,
            retries: 3,
            transport: 'https',
            onError: (error, context) => {
                console.error('ErrorExplorer:', error.message, context);
            },
            onWarning: (message, context) => {
                console.warn('ErrorExplorer:', message, context);
            },
            enableOfflineQueue: true,
            maxQueueSize: 100,
            enableRateLimit: true,
            maxRequestsPerMinute: 60,
            enableCircuitBreaker: true,
            circuitBreakerThreshold: 5,
            circuitBreakerTimeout: 30000,
            ...config,
        };
        this.breadcrumbManager = new BreadcrumbManager_1.BreadcrumbManager(this.config.maxBreadcrumbs);
        this.offlineQueue = new OfflineQueue_1.OfflineQueue({
            maxQueueSize: this.config.maxQueueSize,
            maxRetries: this.config.retries,
            onError: this.config.onError,
            onWarning: this.config.onWarning,
        });
        this.circuitBreaker = new CircuitBreaker_1.CircuitBreaker({
            failureThreshold: this.config.circuitBreakerThreshold,
            timeout: this.config.circuitBreakerTimeout,
            resetTimeout: this.config.circuitBreakerTimeout * 2,
        });
        this.rateLimiter = new RateLimiter_1.RateLimiter({
            maxRequests: this.config.maxRequestsPerMinute,
            windowMs: 60000,
            skipSuccessful: true,
        });
        this.httpClient = axios_1.default.create({
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': `ErrorExplorer-Node/${process.version}`,
            },
        });
        if (this.config.userId || this.config.userEmail) {
            this.setUser({
                id: this.config.userId,
                email: this.config.userEmail,
            });
        }
        if (this.config.enableOfflineQueue && process.env.NODE_ENV !== 'test') {
            this.startQueueProcessing();
        }
    }
    setUser(user) {
        this.userContext = { ...this.userContext, ...user };
    }
    addBreadcrumb(message, category = 'custom', level = 'info', data) {
        this.breadcrumbManager.addBreadcrumb({
            message,
            category,
            level,
            data,
        });
    }
    async captureException(error, context, request) {
        if (!this.config.enabled) {
            return Promise.resolve();
        }
        const errorData = await this.formatError(error, context, request);
        if (this.config.beforeSend) {
            const processedData = this.config.beforeSend(errorData);
            if (!processedData) {
                return Promise.resolve();
            }
            return this.sendError(processedData);
        }
        return this.sendError(errorData);
    }
    captureMessage(message, level = 'info', context) {
        const error = new Error(message);
        error.name = 'CapturedMessage';
        return this.captureException(error, { ...context, level });
    }
    async formatError(error, context, request) {
        const stack = error.stack || '';
        const lines = stack.split('\n');
        const firstLine = lines[1] || '';
        const match = firstLine.match(/\((.+):(\d+):(\d+)\)/) || firstLine.match(/at (.+):(\d+):(\d+)/);
        const file = match ? match[1] : 'unknown';
        const line = match ? parseInt(match[2], 10) : 0;
        const errorData = {
            message: error.message,
            exception_class: error.constructor.name,
            stack_trace: stack,
            file,
            line,
            project: this.config.projectName,
            environment: this.config.environment,
            commitHash: await this.getCommitHash(),
            timestamp: new Date().toISOString(),
            server: this.getServerData(),
            breadcrumbs: this.breadcrumbManager.getBreadcrumbs(),
            user: Object.keys(this.userContext).length > 0 ? this.userContext : undefined,
            context,
        };
        if (request) {
            errorData.request = this.formatRequest(request);
            if (request.res && request.res.statusCode) {
                errorData.http_status = request.res.statusCode;
            }
        }
        return errorData;
    }
    async detectCommitHash() {
        try {
            const { stdout } = await execAsync('git rev-parse HEAD', { timeout: 1000 });
            return stdout.trim();
        }
        catch (_a) {
            return null;
        }
    }
    async getCommitHash() {
        if (this.commitHash === null) {
            this.commitHash = await this.detectCommitHash();
        }
        return this.commitHash;
    }
    formatRequest(req) {
        const request = {};
        if (req.url)
            request.url = req.url;
        if (req.method)
            request.method = req.method;
        if (req.headers) {
            request.headers = { ...req.headers };
            if (request.headers) {
                delete request.headers.authorization;
                delete request.headers.cookie;
            }
        }
        if (req.query)
            request.query = req.query;
        if (req.body && typeof req.body === 'object') {
            request.body = { ...req.body };
            this.sanitizeBody(request.body);
        }
        if (req.ip)
            request.ip = req.ip;
        if (req.get && req.get('user-agent'))
            request.user_agent = req.get('user-agent');
        return request;
    }
    sanitizeBody(body) {
        const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'authorization'];
        if (typeof body === 'object' && body !== null) {
            for (const key in body) {
                if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
                    body[key] = '[FILTERED]';
                }
                else if (typeof body[key] === 'object') {
                    this.sanitizeBody(body[key]);
                }
            }
        }
    }
    getServerData() {
        const memUsage = process.memoryUsage();
        return {
            node_version: process.version,
            platform: os.platform(),
            arch: os.arch(),
            memory_usage: memUsage.heapUsed,
            uptime: process.uptime(),
            pid: process.pid,
        };
    }
    async sendError(errorData) {
        if (this.config.enableRateLimit && !this.rateLimiter.isAllowed()) {
            if (this.config.enableOfflineQueue) {
                this.offlineQueue.enqueue(errorData);
                this.config.onWarning('Rate limited, queued for later sending', { errorData });
                return;
            }
            else {
                this.config.onWarning('Rate limited, dropping error', { errorData });
                return;
            }
        }
        try {
            if (this.config.enableCircuitBreaker) {
                await this.circuitBreaker.execute(async () => {
                    await this.httpClient.post(this.config.webhookUrl, errorData);
                });
            }
            else {
                await this.httpClient.post(this.config.webhookUrl, errorData);
            }
            if (this.config.enableRateLimit) {
                this.rateLimiter.recordRequest(true);
            }
        }
        catch (error) {
            if (this.config.enableRateLimit) {
                this.rateLimiter.recordRequest(false);
            }
            if (this.config.enableOfflineQueue) {
                this.offlineQueue.enqueue(errorData);
                this.config.onWarning('Failed to send error, queued for later', { error: error.message, errorData });
            }
            else {
                this.config.onError(new Error('Failed to send error: ' + error.message), { originalError: error, errorData });
            }
        }
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    getBreadcrumbManager() {
        return this.breadcrumbManager;
    }
    getConfig() {
        return { ...this.config };
    }
    getQueueSize() {
        return this.offlineQueue.getQueueSize();
    }
    getCircuitBreakerState() {
        return this.circuitBreaker.getState();
    }
    getRateLimitInfo() {
        return {
            remaining: this.rateLimiter.getRemainingRequests(),
            resetTime: this.rateLimiter.getResetTime(),
        };
    }
    async flushQueue() {
        await this.processOfflineQueue();
    }
    clearQueue() {
        this.offlineQueue.clearQueue();
    }
    startQueueProcessing() {
        this.queueProcessingInterval = setInterval(() => {
            this.processOfflineQueue().catch(error => {
                this.config.onWarning('Queue processing failed', { error: error.message });
            });
        }, 30000);
    }
    destroy() {
        if (this.queueProcessingInterval) {
            clearInterval(this.queueProcessingInterval);
            this.queueProcessingInterval = null;
        }
    }
    handleError(error, context) {
        this.config.onError(error, context);
    }
    handleWarning(message, context) {
        this.config.onWarning(message, context);
    }
    async processOfflineQueue() {
        await this.offlineQueue.processQueue(async (errorData) => {
            if (this.config.enableCircuitBreaker) {
                await this.circuitBreaker.execute(async () => {
                    await this.httpClient.post(this.config.webhookUrl, errorData);
                });
            }
            else {
                await this.httpClient.post(this.config.webhookUrl, errorData);
            }
        });
    }
}
exports.ErrorReporter = ErrorReporter;
//# sourceMappingURL=ErrorReporter.js.map