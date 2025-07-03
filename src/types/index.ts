export interface ErrorExplorerConfig {
  webhookUrl: string;
  projectName: string;
  environment?: string;
  enabled?: boolean;
  userId?: string | number;
  userEmail?: string;
  maxBreadcrumbs?: number;
  timeout?: number;
  retries?: number;
  beforeSend?: (data: ErrorData) => ErrorData | null;
  transport?: 'http' | 'https';
  // Error handling callbacks
  onError?: (error: Error, context?: Record<string, any>) => void;
  onWarning?: (message: string, context?: Record<string, any>) => void;
  // Offline queue options
  enableOfflineQueue?: boolean;
  maxQueueSize?: number;
  // Rate limiting options
  enableRateLimit?: boolean;
  maxRequestsPerMinute?: number;
  // Circuit breaker options
  enableCircuitBreaker?: boolean;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
}

export interface InternalErrorExplorerConfig {
  webhookUrl: string;
  projectName: string;
  environment: string;
  enabled: boolean;
  userId?: string | number;
  userEmail?: string;
  maxBreadcrumbs: number;
  timeout: number;
  retries: number;
  beforeSend?: (data: ErrorData) => ErrorData | null;
  transport: 'http' | 'https';
  // Error handling callbacks
  onError: (error: Error, context?: Record<string, any>) => void;
  onWarning: (message: string, context?: Record<string, any>) => void;
  // Offline queue options
  enableOfflineQueue: boolean;
  maxQueueSize: number;
  // Rate limiting options
  enableRateLimit: boolean;
  maxRequestsPerMinute: number;
  // Circuit breaker options
  enableCircuitBreaker: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

export interface ErrorData {
  message: string;
  exception_class: string;
  stack_trace: string;
  file: string;
  line: number;
  project: string;
  environment: string;
  timestamp: string;
  commitHash?: string | null;
  http_status?: number;
  request?: RequestData;
  server?: ServerData;
  context?: Record<string, any>;
  breadcrumbs?: Breadcrumb[];
  user?: UserContext;
}

export interface RequestData {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, any>;
  body?: any;
  ip?: string;
  user_agent?: string;
}

export interface ServerData {
  node_version: string;
  platform: string;
  arch: string;
  memory_usage: number;
  uptime: number;
  pid: number;
}

export interface UserContext {
  id?: string | number;
  email?: string;
  username?: string;
  ip?: string;
  [key: string]: any;
}

export interface Breadcrumb {
  message: string;
  category: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  timestamp: string;
  data?: Record<string, any>;
}

export interface ExpressOptions {
  captureRequestBody?: boolean;
  captureRequestHeaders?: boolean;
  skipHealthChecks?: boolean;
  skipPaths?: string[];
}
