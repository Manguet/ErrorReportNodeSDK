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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfflineQueue = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
class OfflineQueue {
    constructor(options = {}) {
        this.queue = [];
        this.isProcessing = false;
        this.maxQueueSize = options.maxQueueSize || 100;
        this.maxRetries = options.maxRetries || 3;
        this.queueFile = options.queueFile || path.join(os.tmpdir(), 'error-explorer-queue.json');
        this.onError = options.onError || ((error) => console.error('ErrorExplorer:', error.message));
        this.onWarning = options.onWarning || ((message) => console.warn('ErrorExplorer:', message));
        this.loadQueue();
    }
    enqueue(data) {
        const queuedError = {
            id: this.generateId(),
            data,
            timestamp: Date.now(),
            attempts: 0,
        };
        this.queue.push(queuedError);
        if (this.queue.length > this.maxQueueSize) {
            this.queue.shift();
        }
        this.saveQueue();
    }
    async processQueue(sender) {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }
        this.isProcessing = true;
        try {
            const successfulIds = [];
            for (const queuedError of [...this.queue]) {
                try {
                    await sender(queuedError.data);
                    successfulIds.push(queuedError.id);
                }
                catch (error) {
                    queuedError.attempts++;
                    if (queuedError.attempts >= this.maxRetries) {
                        successfulIds.push(queuedError.id);
                        this.onWarning(`Dropping error after ${this.maxRetries} failed attempts`, { error, queuedError });
                    }
                }
            }
            this.queue = this.queue.filter(item => !successfulIds.includes(item.id));
            this.saveQueue();
        }
        finally {
            this.isProcessing = false;
        }
    }
    getQueueSize() {
        return this.queue.length;
    }
    clearQueue() {
        this.queue = [];
        this.saveQueue();
    }
    loadQueue() {
        try {
            if (fs.existsSync(this.queueFile)) {
                const data = fs.readFileSync(this.queueFile, 'utf8');
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    this.queue = parsed;
                    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
                    this.queue = this.queue.filter(item => item.timestamp > dayAgo);
                }
            }
        }
        catch (error) {
            this.onWarning('Failed to load queue file', { error });
            this.queue = [];
        }
    }
    saveQueue() {
        try {
            const dir = path.dirname(this.queueFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
        }
        catch (error) {
            console.warn('ErrorExplorer: Failed to save queue file:', error);
        }
    }
    generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    add(data) {
        this.enqueue(data);
    }
    setSendFunction(sendFn) {
        this.sendFunction = sendFn;
    }
    async flush() {
        if (!this.sendFunction || this.isProcessing) {
            return;
        }
        this.isProcessing = true;
        const itemsToProcess = [...this.queue];
        for (const item of itemsToProcess) {
            try {
                await this.sendFunction(item.data);
                this.queue = this.queue.filter(q => q.id !== item.id);
            }
            catch (error) {
                item.attempts++;
                if (item.attempts >= this.maxRetries) {
                    this.queue = this.queue.filter(q => q.id !== item.id);
                }
            }
        }
        this.saveQueue();
        this.isProcessing = false;
    }
    getStats() {
        return {
            queueSize: this.queue.length,
            oldestItem: this.queue.length > 0 ? this.queue[0].timestamp : null
        };
    }
}
exports.OfflineQueue = OfflineQueue;
//# sourceMappingURL=OfflineQueue.js.map