export interface SecurityConfig {
  requireHttps: boolean;
  validateTokens: boolean;
  maxPayloadSize: number;
  allowedDomains: string[];
  sensitiveDataPatterns: RegExp[];
  enableSanitization: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class SecurityValidator {
  private config: SecurityConfig;
  private defaultSensitivePatterns: RegExp[] = [
    // Credit card numbers
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    // Social Security Numbers
    /\b\d{3}-\d{2}-\d{4}\b/g,
    // Email addresses (might be sensitive in some contexts)
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    // Phone numbers
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    // IP addresses
    /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
    // JWT tokens
    /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g,
    // API keys (common patterns)
    /\b[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]\s*[:=]\s*[A-Za-z0-9_-]{6,}\b/gi,
    // Passwords (in URLs or JSON)
    /["\']?[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]["\']?\s*[:=]\s*["\'][^"\']*["\']?/gi,
    // Access tokens
    /\b[Aa]ccess[_-]?[Tt]oken[:\s]*[A-Za-z0-9_-]{20,}\b/g,
  ];

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = {
      requireHttps: true,
      validateTokens: true,
      maxPayloadSize: 1024 * 1024, // 1MB
      allowedDomains: [],
      sensitiveDataPatterns: this.defaultSensitivePatterns,
      enableSanitization: true,
      ...config,
    };
  }

  validateWebhookUrl(url: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const parsedUrl = new URL(url);

      // Check protocol
      if (this.config.requireHttps && parsedUrl.protocol !== 'https:') {
        errors.push('HTTPS is required for webhook URLs');
      }

      // Check allowed domains
      if (this.config.allowedDomains.length > 0) {
        const isAllowed = this.config.allowedDomains.some(domain => 
          parsedUrl.hostname.includes(domain)
        );
        if (!isAllowed) {
          errors.push(`Domain ${parsedUrl.hostname} is not in allowed domains list`);
        }
      }

      // Check for localhost in production
      if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
        warnings.push('Using localhost URL - this may not work in production environments');
      }

    } catch (error) {
      errors.push(`Invalid URL format: ${(error as Error).message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateErrorData(errorData: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check payload size
    const payloadSize = this.calculatePayloadSize(errorData);
    if (payloadSize > this.config.maxPayloadSize) {
      errors.push(
        `Payload size (${payloadSize} bytes) exceeds maximum allowed size (${this.config.maxPayloadSize} bytes)`
      );
    }

    // Check required fields
    if (!errorData.message) {
      errors.push('Error message is required');
    }

    if (!errorData.project) {
      errors.push('Project name is required');
    }

    if (!errorData.timestamp) {
      errors.push('Timestamp is required');
    }

    // Validate data types
    if (errorData.timestamp && !this.isValidTimestamp(errorData.timestamp)) {
      errors.push('Invalid timestamp format');
    }

    if (errorData.breadcrumbs && !Array.isArray(errorData.breadcrumbs)) {
      errors.push('Breadcrumbs must be an array');
    }

    // Check for sensitive data
    if (this.config.enableSanitization) {
      const sensitiveDataFound = this.detectSensitiveData(errorData);
      if (sensitiveDataFound.length > 0) {
        warnings.push(`Potential sensitive data detected: ${sensitiveDataFound.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  sanitizeSensitiveData(data: any): any {
    if (!this.config.enableSanitization) {
      return data;
    }

    return this.deepSanitize(data);
  }

  private deepSanitize(obj: any, visited = new WeakSet()): any {
    // Handle null and undefined
    if (obj === null || obj === undefined) {
      // Check if the key itself needs to be redacted
      return obj;
    }
    
    if (typeof obj === 'string') {
      return this.sanitizeText(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepSanitize(item, visited));
    }

    if (obj && typeof obj === 'object') {
      // Handle circular references
      if (visited.has(obj)) {
        return '[Circular Reference]';
      }
      visited.add(obj);
      
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // Sanitize key names that might be sensitive
        if (this.isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.deepSanitize(value, visited);
        }
      }
      return sanitized;
    }

    return obj;
  }

  private sanitizeText(text: string): string {
    let sanitized = text;
    
    for (const pattern of this.config.sensitiveDataPatterns) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    
    return sanitized;
  }

  private isSensitiveKey(key: string): boolean {
    const sensitiveKeys = [
      'password', 'token', 'secret', 'key', 'api_key', 
      'authorization', 'auth', 'credential', 'access_token'
    ];
    
    const lowerKey = key.toLowerCase();
    return sensitiveKeys.some(sensitive => lowerKey.includes(sensitive));
  }

  private detectSensitiveData(data: any): string[] {
    const found: Set<string> = new Set();
    const textToCheck = this.extractTextFromObject(data);
    
    for (const pattern of this.config.sensitiveDataPatterns) {
      // Create a new RegExp instance to avoid state issues
      const testPattern = new RegExp(pattern.source, pattern.flags);
      if (testPattern.test(textToCheck)) {
        if (pattern.source.includes('\\d{4}[-\\s]?\\d{4}')) {
          found.add('Credit Card');
        } else if (pattern.source.includes('\\d{3}-\\d{2}-\\d{4}')) {
          found.add('SSN');
        } else if (pattern.source.includes('@')) {
          found.add('Email');
        } else if (pattern.source.includes('eyJ')) {
          found.add('JWT Token');
        } else if (pattern.source.toLowerCase().includes('api') && pattern.source.toLowerCase().includes('key')) {
          found.add('API Key');
        } else if (pattern.source.toLowerCase().includes('password')) {
          found.add('Password');
        } else if (pattern.source.includes('[Aa]ccess[_-]?[Tt]oken')) {
          found.add('Access Token');
        } else {
          found.add('PII');
        }
      }
    }
    
    return Array.from(found);
  }

  private extractTextFromObject(obj: any): string {
    if (typeof obj === 'string') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.extractTextFromObject(item)).join(' ');
    }

    if (obj && typeof obj === 'object') {
      return Object.values(obj).map(value => this.extractTextFromObject(value)).join(' ');
    }

    return String(obj || '');
  }

  private calculatePayloadSize(data: any): number {
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  }

  private isValidTimestamp(timestamp: any): boolean {
    if (typeof timestamp !== 'string' && typeof timestamp !== 'number') {
      return false;
    }
    
    // For strings, check if they are valid ISO format or valid date strings
    if (typeof timestamp === 'string') {
      const date = new Date(timestamp);
      return !isNaN(date.getTime()) && date.getTime() > 0;
    }
    
    // For numbers, they should be reasonable timestamps (not just any number)
    if (typeof timestamp === 'number') {
      // Should be a reasonable timestamp (milliseconds since epoch, so > 1970)
      // 12345 would be January 1, 1970 00:00:12, which is too small to be a real timestamp
      const minTimestamp = new Date('1990-01-01').getTime(); // More reasonable minimum
      const maxTimestamp = new Date('2100-01-01').getTime();
      return timestamp >= minTimestamp && timestamp <= maxTimestamp;
    }
    
    return false;
  }

  validateConfiguration(config: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate webhook URL
    if (config.webhookUrl) {
      const urlValidation = this.validateWebhookUrl(config.webhookUrl);
      errors.push(...urlValidation.errors);
      warnings.push(...urlValidation.warnings);
    } else {
      errors.push('Webhook URL is required');
    }

    // Validate project name
    if (!config.projectName || typeof config.projectName !== 'string' || config.projectName.trim().length === 0) {
      errors.push('Project name is required and must be a non-empty string');
    }

    // Validate environment
    if (config.environment && typeof config.environment !== 'string') {
      warnings.push('Environment should be a string');
    }

    // Validate timeout
    if (config.timeout && (typeof config.timeout !== 'number' || config.timeout < 1000 || config.timeout > 30000)) {
      warnings.push('Timeout should be a number between 1000ms and 30000ms');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  updateConfig(updates: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  // Utility method to test sensitive data detection
  testSensitiveDataDetection(text: string): string[] {
    return this.detectSensitiveData({ testData: text });
  }

  // Method to add custom sensitive data patterns
  addSensitivePattern(pattern: RegExp): void {
    if (!this.config.sensitiveDataPatterns.includes(pattern)) {
      this.config.sensitiveDataPatterns.push(pattern);
    }
  }

  removeSensitivePattern(pattern: RegExp): void {
    const index = this.config.sensitiveDataPatterns.indexOf(pattern);
    if (index > -1) {
      this.config.sensitiveDataPatterns.splice(index, 1);
    }
  }
}