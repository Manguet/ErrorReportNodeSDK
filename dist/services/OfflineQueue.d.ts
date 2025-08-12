import { ErrorData } from '../types';
export interface QueuedError {
    id: string;
    data: ErrorData;
    timestamp: number;
    attempts: number;
}
export declare class OfflineQueue {
    private queueFile;
    private maxQueueSize;
    private maxRetries;
    private queue;
    private isProcessing;
    private onError;
    private onWarning;
    constructor(options?: {
        maxQueueSize?: number;
        maxRetries?: number;
        queueFile?: string;
        onError?: (error: Error, context?: Record<string, any>) => void;
        onWarning?: (message: string, context?: Record<string, any>) => void;
    });
    enqueue(data: ErrorData): void;
    processQueue(sender: (data: ErrorData) => Promise<void>): Promise<void>;
    getQueueSize(): number;
    clearQueue(): void;
    private loadQueue;
    private saveQueue;
    private generateId;
    add(data: ErrorData): void;
    setSendFunction(sendFn: (data: ErrorData) => Promise<void>): void;
    private sendFunction?;
    flush(): Promise<void>;
    getStats(): {
        queueSize: number;
        oldestItem: number | null;
    };
}
//# sourceMappingURL=OfflineQueue.d.ts.map