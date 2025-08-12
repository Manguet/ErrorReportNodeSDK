# @error-explorer/node

Node.js SDK for Error Explorer - Capture and report errors automatically from your Node.js applications.

## ✨ What's New in v1.1.0

- **🚀 Non-blocking Initialization**: SDK no longer blocks app startup with synchronous Git operations
- **🛡️ Custom Error Handling**: Configurable `onError` and `onWarning` callbacks for better integration
- **⚡ Performance Features**: Built-in offline queue, rate limiting, and circuit breaker
- **🔧 Better TypeScript Support**: Enhanced type definitions and improved developer experience
- **📊 Health Monitoring**: New methods to monitor SDK performance and status

### Migration from v1.0.x

No breaking changes! All existing code continues to work. New features are opt-in:

```javascript
// v1.0.x - still works
ErrorExplorer.init({
  webhookUrl: 'https://error-explorer.com',
  projectName: 'my-app'
});

// v1.1.0 - enhanced with custom error handling
ErrorExplorer.init({
  webhookUrl: 'https://error-explorer.com',
  projectName: 'my-app',
  onError: (error, context) => myLogger.error('ErrorExplorer failed:', error),
  onWarning: (message, context) => myLogger.warn('ErrorExplorer:', message)
});
```

## Installation

```bash
npm install @error-explorer/node
# or
yarn add @error-explorer/node
```

## Quick Start

### Basic Setup

```javascript
const { ErrorExplorer } = require('@error-explorer/node');

ErrorExplorer.init({
  webhookUrl: process.env.ERROR_EXPLORER_WEBHOOK_URL,
  projectName: process.env.ERROR_EXPLORER_PROJECT_NAME || 'my-node-app',
  environment: process.env.NODE_ENV || 'development',
});

// Capture uncaught exceptions and unhandled rejections
process.on('uncaughtException', ErrorExplorer.captureException);
process.on('unhandledRejection', ErrorExplorer.captureException);
```

### Express.js Integration

```javascript
const express = require('express');
const { ErrorExplorer } = require('@error-explorer/node');

const app = express();

// Initialize ErrorExplorer (two ways available)
ErrorExplorer.init({
  webhookUrl: process.env.ERROR_EXPLORER_WEBHOOK_URL,
  projectName: 'my-express-app',
  environment: process.env.NODE_ENV,
});

// Alternative: using configure() method (alias for init())
// ErrorExplorer.configure({
//   webhookUrl: process.env.ERROR_EXPLORER_WEBHOOK_URL,
//   projectName: 'my-express-app',
//   environment: process.env.NODE_ENV,
// });

// Setup automatic Express integration
ErrorExplorer.setupExpress(app, {
  captureRequestBody: true,
  captureRequestHeaders: true,
  skipHealthChecks: true,
  skipPaths: ['/favicon.ico']
});

// Your routes here
app.get('/', (req, res) => {
  res.send('Hello World!');
});

// Error route for testing
app.get('/error/test', (req, res) => {
  throw new Error('Test error from Node Express');
});

// Start server
app.listen(3000);
```

### Manual Error Capturing

```javascript
try {
  // Your code here
  riskyOperation();
} catch (error) {
  // Capture the exception with context
  ErrorExplorer.captureException(error, {
    userId: req.user?.id,
    action: 'riskyOperation',
    additionalData: { some: 'data' }
  });
}

// Capture custom messages
ErrorExplorer.captureMessage('Something went wrong', 'error', {
  context: 'custom operation'
});
```

## Configuration

### Required Options

- `webhookUrl`: Your Error Explorer webhook URL
- `projectName`: Name of your project

### Optional Options

```javascript
ErrorExplorer.init({
  webhookUrl: 'https://your-domain.com/webhook/project-token',
  projectName: 'my-node-app',
  environment: 'production',        // Default: 'production'
  enabled: true,                    // Default: true
  userId: 'user123',               // Optional: Default user ID
  userEmail: 'user@example.com',   // Optional: Default user email
  maxBreadcrumbs: 50,              // Default: 50
  timeout: 5000,                   // Default: 5000ms
  retries: 3,                      // Default: 3
  
  // Custom error handling callbacks
  onError: (error, context) => {   // Optional: Custom error handling
    console.error('ErrorExplorer failed:', error.message, context);
  },
  onWarning: (message, context) => { // Optional: Custom warning handling
    console.warn('ErrorExplorer warning:', message, context);
  },
  
  beforeSend: (data) => {          // Optional: Filter/modify data before sending
    // Filter sensitive data
    if (data.context?.password) {
      data.context.password = '[FILTERED]';
    }
    return data;
  },

  // Advanced options
  enableOfflineQueue: true,        // Default: true - Queue errors when offline
  maxQueueSize: 100,              // Default: 100 - Max queued errors
  enableRateLimit: true,          // Default: true - Rate limit requests
  maxRequestsPerMinute: 60,       // Default: 60 - Max requests per minute
  enableCircuitBreaker: true,     // Default: true - Circuit breaker pattern
  circuitBreakerThreshold: 5,     // Default: 5 - Failures before opening circuit
  circuitBreakerTimeout: 30000,   // Default: 30s - Circuit breaker timeout
});
```

## Advanced Error Handling

### Custom Error and Warning Callbacks

By default, ErrorExplorer logs errors and warnings to the console. You can customize this behavior to integrate with your existing logging infrastructure:

```javascript
ErrorExplorer.init({
  webhookUrl: 'https://your-domain.com/webhook/project-token',
  projectName: 'my-app',
  
  // Custom error handling - called when ErrorExplorer itself fails
  onError: (error, context) => {
    // Log to your custom logger
    myLogger.error('ErrorExplorer internal error:', {
      error: error.message,
      stack: error.stack,
      context
    });
    
    // Send to alerting system
    alertManager.sendAlert('ErrorExplorer Failure', error);
  },
  
  // Custom warning handling - called for non-critical issues
  onWarning: (message, context) => {
    // Log to your custom logger
    myLogger.warn('ErrorExplorer warning:', { message, context });
    
    // Increment metrics
    metrics.increment('error_explorer.warnings', {
      message
    });
  }
});
```

### Environment-Specific Configuration

```javascript
const isProduction = process.env.NODE_ENV === 'production';

ErrorExplorer.init({
  webhookUrl: process.env.ERROR_EXPLORER_WEBHOOK_URL,
  projectName: 'my-app',
  environment: process.env.NODE_ENV,
  
  onError: isProduction 
    ? (error, context) => {
        // Production: Send to PagerDuty
        pagerDuty.trigger('ErrorExplorer failure', error);
      }
    : (error, context) => {
        // Development: Detailed console logs
        console.error('ErrorExplorer error:', error, context);
      },
      
  onWarning: isProduction
    ? (message, context) => {
        // Production: Log to structured logger
        logger.warn('ErrorExplorer warning', { message, context });
      }
    : (message, context) => {
        // Development: Simple console warning
        console.warn(`ErrorExplorer: ${message}`, context);
      }
});
```

### Integration with Popular Loggers

#### Winston Integration

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

ErrorExplorer.init({
  webhookUrl: process.env.ERROR_EXPLORER_WEBHOOK_URL,
  projectName: 'my-app',
  onError: (error, context) => {
    logger.error('ErrorExplorer failure', { 
      error: error.message, 
      context 
    });
  },
  onWarning: (message, context) => {
    logger.warn('ErrorExplorer warning', { 
      message, 
      context 
    });
  }
});
```

#### Pino Integration

```javascript
const pino = require('pino');
const logger = pino();

ErrorExplorer.init({
  webhookUrl: process.env.ERROR_EXPLORER_WEBHOOK_URL,
  projectName: 'my-app',
  onError: (error, context) => {
    logger.error({ err: error, context }, 'ErrorExplorer failure');
  },
  onWarning: (message, context) => {
    logger.warn({ context }, 'ErrorExplorer warning: %s', message);
  }
});
```

## Express.js Options

```javascript
ErrorExplorer.setupExpress(app, {
  captureRequestBody: true,        // Default: false
  captureRequestHeaders: true,     // Default: false
  skipHealthChecks: true,          // Default: false
  skipPaths: ['/admin', '/api/health'] // Default: []
});
```

## API Reference

### ErrorExplorer.init(config)

Initializes the Error Explorer SDK.

### ErrorExplorer.configure(config)

Alias for `ErrorExplorer.init(config)`. Both methods work identically.

### ErrorExplorer.captureException(error, context?)

Captures an exception with optional context.

```javascript
ErrorExplorer.captureException(new Error('Something went wrong'), {
  userId: 123,
  action: 'checkout'
});
```

### ErrorExplorer.captureMessage(message, level?, context?)

Captures a custom message.

```javascript
ErrorExplorer.captureMessage('User logged in', 'info', {
  userId: 123
});
```

### ErrorExplorer.addBreadcrumb(message, category?, level?, data?)

Adds a breadcrumb for debugging context.

```javascript
ErrorExplorer.addBreadcrumb('User clicked button', 'ui', 'info', {
  buttonId: 'submit-btn'
});
```

### ErrorExplorer.setUser(user)

Sets user context for all future error reports.

```javascript
ErrorExplorer.setUser({
  id: 123,
  email: 'user@example.com',
  username: 'john_doe'
});
```

### ErrorExplorer.setupExpress(app, options?)

Sets up automatic Express.js integration.

## Performance & Resilience Features

### Offline Queue
ErrorExplorer automatically queues errors when the service is unreachable and retries them later:

```javascript
ErrorExplorer.init({
  webhookUrl: 'https://your-domain.com/webhook/project-token',
  projectName: 'my-app',
  enableOfflineQueue: true,        // Default: true
  maxQueueSize: 100,              // Default: 100
  retries: 3,                     // Default: 3
});
```

### Rate Limiting
Prevents overwhelming the Error Explorer service with too many requests:

```javascript
ErrorExplorer.init({
  webhookUrl: 'https://your-domain.com/webhook/project-token',
  projectName: 'my-app',
  enableRateLimit: true,          // Default: true
  maxRequestsPerMinute: 60,       // Default: 60
});
```

### Circuit Breaker
Automatically stops sending requests when the service is consistently failing:

```javascript
ErrorExplorer.init({
  webhookUrl: 'https://your-domain.com/webhook/project-token',
  projectName: 'my-app',
  enableCircuitBreaker: true,     // Default: true
  circuitBreakerThreshold: 5,     // Default: 5 failures before opening
  circuitBreakerTimeout: 30000,   // Default: 30s timeout
});
```

### Non-blocking Initialization
The SDK initializes asynchronously and won't block your application startup:

```javascript
// ✅ Non-blocking - won't delay your app startup
ErrorExplorer.init({
  webhookUrl: 'https://your-domain.com/webhook/project-token',
  projectName: 'my-app',
});

// Your app starts immediately, even if git operations take time
app.listen(3000, () => {
  console.log('Server started!'); // This won't be delayed
});
```

### Monitoring SDK Health

```javascript
const errorReporter = ErrorExplorer.init({
  webhookUrl: 'https://your-domain.com/webhook/project-token',
  projectName: 'my-app',
});

// Check queue size
console.log('Queued errors:', errorReporter.getQueueSize());

// Check circuit breaker state
console.log('Circuit breaker:', errorReporter.getCircuitBreakerState());

// Check rate limit status
const rateLimitInfo = errorReporter.getRateLimitInfo();
console.log('Rate limit remaining:', rateLimitInfo.remaining);

// Manually flush queued errors
await errorReporter.flushQueue();

// Clear queue (useful for testing)
errorReporter.clearQueue();

// Cleanup resources
errorReporter.destroy();
```

## Environment Variables

You can use environment variables for configuration:

```bash
ERROR_EXPLORER_WEBHOOK_URL=https://your-domain.com/webhook/project-token
ERROR_EXPLORER_PROJECT_NAME=my-node-app
NODE_ENV=production
```

## TypeScript Support

This package includes comprehensive TypeScript definitions with full IntelliSense support.

```typescript
import ErrorExplorer, { ErrorExplorerConfig } from '@error-explorer/node';

const config: ErrorExplorerConfig = {
  webhookUrl: process.env.ERROR_EXPLORER_WEBHOOK_URL!,
  projectName: 'my-typescript-app',
  environment: process.env.NODE_ENV,
  
  // TypeScript provides full autocomplete and type checking
  onError: (error: Error, context?: Record<string, any>) => {
    console.error('ErrorExplorer failed:', error.message, context);
  },
  
  onWarning: (message: string, context?: Record<string, any>) => {
    console.warn('ErrorExplorer warning:', message, context);
  }
};

const errorReporter = ErrorExplorer.init(config);

// All methods are fully typed
await errorReporter.captureException(new Error('Test'), { userId: 123 });
errorReporter.setUser({ id: 123, email: 'user@example.com' });
errorReporter.addBreadcrumb('User action', 'ui', 'info', { buttonId: 'submit' });

// Health monitoring methods are typed too
const queueSize: number = errorReporter.getQueueSize();
const circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = errorReporter.getCircuitBreakerState();
const rateLimitInfo: { remaining: number; resetTime: number } = errorReporter.getRateLimitInfo();
```

## Examples

### Production-Ready Express Setup

```javascript
const express = require('express');
const ErrorExplorer = require('@error-explorer/node');
const winston = require('winston');

const app = express();

// Setup structured logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.Console()
  ]
});

// Initialize ErrorExplorer with production configuration
const errorReporter = ErrorExplorer.init({
  webhookUrl: process.env.ERROR_EXPLORER_WEBHOOK_URL,
  projectName: 'my-production-app',
  environment: process.env.NODE_ENV,
  
  // Custom error handling integrated with logging infrastructure
  onError: (error, context) => {
    logger.error('ErrorExplorer SDK failure', {
      error: error.message,
      stack: error.stack,
      context,
      service: 'error-explorer-sdk'
    });
    
    // Send to alerting system in production
    if (process.env.NODE_ENV === 'production') {
      // alertManager.critical('ErrorExplorer SDK down', error);
    }
  },
  
  onWarning: (message, context) => {
    logger.warn('ErrorExplorer SDK warning', {
      message,
      context,
      service: 'error-explorer-sdk'
    });
  },
  
  // Performance tuning for high-traffic apps
  maxRequestsPerMinute: 120,
  maxQueueSize: 200,
  circuitBreakerThreshold: 10
});

// Middleware to set user context
app.use((req, res, next) => {
  if (req.user) {
    ErrorExplorer.setUser({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role
    });
  }
  next();
});

// Setup Express integration with custom options
ErrorExplorer.setupExpress(app, {
  captureRequestBody: true,
  captureRequestHeaders: true,
  skipHealthChecks: true,
  skipPaths: ['/favicon.ico', '/metrics', '/health']
});

// Health check endpoint that includes ErrorExplorer status
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    errorExplorer: {
      queueSize: errorReporter.getQueueSize(),
      circuitBreaker: errorReporter.getCircuitBreakerState(),
      rateLimit: errorReporter.getRateLimitInfo()
    }
  };
  
  res.json(health);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Flush any queued errors before shutdown
  errorReporter.flushQueue()
    .then(() => {
      logger.info('ErrorExplorer queue flushed');
      errorReporter.destroy();
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Failed to flush ErrorExplorer queue', error);
      errorReporter.destroy();
      process.exit(1);
    });
});
```

### With Database Queries

```javascript
const mysql = require('mysql2/promise');

async function getUserById(id) {
  try {
    ErrorExplorer.addBreadcrumb(`Fetching user ${id}`, 'database');
    
    const [rows] = await connection.execute('SELECT * FROM users WHERE id = ?', [id]);
    
    ErrorExplorer.addBreadcrumb(`Found ${rows.length} users`, 'database');
    
    return rows[0];
  } catch (error) {
    ErrorExplorer.captureException(error, {
      query: 'getUserById',
      userId: id
    });
    throw error;
  }
}
```

## License

MIT
