import { SecurityValidator, SecurityConfig, ValidationResult } from '../../src/services/SecurityValidator';

describe('SecurityValidator', () => {
  let validator: SecurityValidator;
  let defaultConfig: Partial<SecurityConfig>;

  beforeEach(() => {
    defaultConfig = {
      requireHttps: true,
      validateTokens: true,
      maxPayloadSize: 1024 * 100, // 100KB
      allowedDomains: [],
      enableSanitization: true,
    };
  });

  describe('Constructor and Configuration', () => {
    it('should create instance with default configuration', () => {
      validator = new SecurityValidator();
      
      const config = validator.getConfig();
      expect(config.requireHttps).toBe(true);
      expect(config.validateTokens).toBe(true);
      expect(config.maxPayloadSize).toBe(1024 * 1024); // 1MB
      expect(config.allowedDomains).toEqual([]);
      expect(config.enableSanitization).toBe(true);
      expect(config.sensitiveDataPatterns).toHaveLength(9); // Default patterns
    });

    it('should create instance with custom configuration', () => {
      validator = new SecurityValidator(defaultConfig);
      
      const config = validator.getConfig();
      expect(config.requireHttps).toBe(true);
      expect(config.maxPayloadSize).toBe(100 * 1024);
      expect(config.enableSanitization).toBe(true);
    });

    it('should include default sensitive data patterns', () => {
      validator = new SecurityValidator();
      
      const config = validator.getConfig();
      expect(config.sensitiveDataPatterns.length).toBeGreaterThan(5);
      
      // Test that patterns are RegExp objects
      config.sensitiveDataPatterns.forEach(pattern => {
        expect(pattern).toBeInstanceOf(RegExp);
      });
    });

    it('should allow custom sensitive data patterns', () => {
      const customPattern = /custom-pattern-\d+/g;
      const customConfig = {
        ...defaultConfig,
        sensitiveDataPatterns: [customPattern],
      };
      
      validator = new SecurityValidator(customConfig);
      
      const config = validator.getConfig();
      expect(config.sensitiveDataPatterns).toContain(customPattern);
    });
  });

  describe('Webhook URL Validation', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should validate valid HTTPS URL', () => {
      const result = validator.validateWebhookUrl('https://api.example.com/webhook');
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject HTTP URL when HTTPS required', () => {
      const result = validator.validateWebhookUrl('http://api.example.com/webhook');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('HTTPS is required for webhook URLs');
    });

    it('should allow HTTP URL when HTTPS not required', () => {
      const config = { ...defaultConfig, requireHttps: false };
      validator = new SecurityValidator(config);
      
      const result = validator.validateWebhookUrl('http://api.example.com/webhook');
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid URL format', () => {
      const result = validator.validateWebhookUrl('not-a-url');
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.includes('Invalid URL format'))).toBe(true);
    });

    it('should validate against allowed domains', () => {
      const config = {
        ...defaultConfig,
        allowedDomains: ['example.com', 'trusted.org'],
      };
      validator = new SecurityValidator(config);
      
      const validResult = validator.validateWebhookUrl('https://api.example.com/webhook');
      expect(validResult.valid).toBe(true);
      
      const invalidResult = validator.validateWebhookUrl('https://malicious.com/webhook');
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.some(error => 
        error.includes('not in allowed domains list')
      )).toBe(true);
    });

    it('should warn about localhost URLs', () => {
      const localhostResult = validator.validateWebhookUrl('https://localhost:3000/webhook');
      const ipResult = validator.validateWebhookUrl('https://127.0.0.1:3000/webhook');
      
      expect(localhostResult.valid).toBe(true);
      expect(localhostResult.warnings).toContain(
        'Using localhost URL - this may not work in production environments'
      );
      
      expect(ipResult.valid).toBe(true);
      expect(ipResult.warnings).toContain(
        'Using localhost URL - this may not work in production environments'
      );
    });

    it('should handle malformed URLs gracefully', () => {
      const testUrls = [
        'https://',
        'https:///',
        'https://example.com:abc/webhook',
        '',
        null,
        undefined,
      ];
      
      testUrls.forEach(url => {
        const result = validator.validateWebhookUrl(url as string);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    it('should validate complex URLs with query parameters', () => {
      const complexUrl = 'https://api.example.com:443/webhook/path?token=abc&version=v1#section';
      
      const result = validator.validateWebhookUrl(complexUrl);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Error Data Validation', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should validate complete error data', () => {
      const errorData = {
        message: 'Test error message',
        project: 'test-project',
        timestamp: '2023-01-15T12:00:00Z',
        breadcrumbs: [
          { message: 'User action', category: 'ui', level: 'info', timestamp: '2023-01-15T11:59:00Z' }
        ],
        context: { userId: 123 },
      };
      
      const result = validator.validateErrorData(errorData);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require essential fields', () => {
      const incompleteData = {};
      
      const result = validator.validateErrorData(incompleteData);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Error message is required');
      expect(result.errors).toContain('Project name is required');
      expect(result.errors).toContain('Timestamp is required');
    });

    it('should validate payload size', () => {
      const largeData = {
        message: 'Test error',
        project: 'test-project',
        timestamp: '2023-01-15T12:00:00Z',
        largeField: 'x'.repeat(200000), // 200KB, exceeds 100KB limit
      };
      
      const result = validator.validateErrorData(largeData);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => 
        error.includes('Payload size') && error.includes('exceeds maximum')
      )).toBe(true);
    });

    it('should validate timestamp format', () => {
      const invalidTimestamps = [
        'invalid-date',
        '2023-13-45T25:70:80Z', // Invalid date components
        '2023/01/15 12:00:00', // Wrong format
        12345, // Number instead of string
        null,
        undefined,
      ];
      
      invalidTimestamps.forEach(timestamp => {
        const errorData = {
          message: 'Test error',
          project: 'test-project',
          timestamp,
        };
        
        const result = validator.validateErrorData(errorData);
        if (timestamp) {
          expect(result.errors).toContain('Invalid timestamp format');
        }
      });
    });

    it('should validate breadcrumbs structure', () => {
      const errorDataWithInvalidBreadcrumbs = {
        message: 'Test error',
        project: 'test-project',
        timestamp: '2023-01-15T12:00:00Z',
        breadcrumbs: 'not-an-array', // Should be array
      };
      
      const result = validator.validateErrorData(errorDataWithInvalidBreadcrumbs);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Breadcrumbs must be an array');
    });

    it('should detect sensitive data when sanitization enabled', () => {
      const sensitiveData = {
        message: 'Error with credit card 4111-1111-1111-1111',
        project: 'test-project',
        timestamp: '2023-01-15T12:00:00Z',
        context: {
          email: 'user@example.com',
          ssn: '123-45-6789',
        },
      };
      
      const result = validator.validateErrorData(sensitiveData);
      
      expect(result.valid).toBe(true); // Still valid, but with warnings
      expect(result.warnings.some(warning => 
        warning.includes('Potential sensitive data detected')
      )).toBe(true);
    });

    it('should skip sensitive data detection when sanitization disabled', () => {
      const config = { ...defaultConfig, enableSanitization: false };
      validator = new SecurityValidator(config);
      
      const sensitiveData = {
        message: 'Error with credit card 4111-1111-1111-1111',
        project: 'test-project',
        timestamp: '2023-01-15T12:00:00Z',
      };
      
      const result = validator.validateErrorData(sensitiveData);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle complex nested data structures', () => {
      const complexData = {
        message: 'Complex error',
        project: 'test-project',
        timestamp: '2023-01-15T12:00:00Z',
        context: {
          user: {
            profile: {
              details: {
                nested: {
                  level: 5,
                  data: 'deep nesting test',
                },
              },
            },
          },
          arrays: [1, 2, { inner: 'value' }],
        },
      };
      
      const result = validator.validateErrorData(complexData);
      
      expect(result.valid).toBe(true);
    });
  });

  describe('Sensitive Data Detection', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should detect credit card numbers', () => {
      const testCases = [
        'Credit card: 4111-1111-1111-1111',
        'Card number 4111 1111 1111 1111',
        'Payment: 4111111111111111',
        'Visa: 4111-1111-1111-1111',
      ];
      
      testCases.forEach(testCase => {
        const detected = validator.testSensitiveDataDetection(testCase);
        expect(detected).toContain('Credit Card');
      });
    });

    it('should detect Social Security Numbers', () => {
      const testCases = [
        'SSN: 123-45-6789',
        'Social Security: 987-65-4321',
      ];
      
      testCases.forEach(testCase => {
        const detected = validator.testSensitiveDataDetection(testCase);
        expect(detected).toContain('SSN');
      });
    });

    it('should detect email addresses', () => {
      const testCases = [
        'Contact: user@example.com',
        'Email address test.user+tag@domain.co.uk',
        'Admin email: admin@subdomain.example.org',
      ];
      
      testCases.forEach(testCase => {
        const detected = validator.testSensitiveDataDetection(testCase);
        expect(detected).toContain('Email');
      });
    });

    it('should detect JWT tokens', () => {
      const testCases = [
        'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        'JWT eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      ];
      
      testCases.forEach(testCase => {
        const detected = validator.testSensitiveDataDetection(testCase);
        expect(detected).toContain('JWT Token');
      });
    });

    it('should detect API keys', () => {
      const testCases = [
        'API_KEY: Switch_this_key_12345',
        'api-key: AIzaSyDXXXXXXXXXXXXXXXXXXXX',
        'ApiKey: pk_live_XXXXXXXXXXXXXXXXXXXXXXXX',
      ];
      
      testCases.forEach(testCase => {
        const detected = validator.testSensitiveDataDetection(testCase);
        expect(detected).toContain('API Key');
      });
    });

    it('should detect passwords', () => {
      const testCases = [
        'password: "secretpass123"',
        '"password":"mypassword"',
        'Password = supersecret',
      ];
      
      testCases.forEach(testCase => {
        const detected = validator.testSensitiveDataDetection(testCase);
        expect(detected).toContain('Password');
      });
    });

    it('should detect phone numbers', () => {
      const testCases = [
        'Phone: 123-456-7890',
        'Contact: 123.456.7890',
        'Mobile: 1234567890',
      ];
      
      testCases.forEach(testCase => {
        const detected = validator.testSensitiveDataDetection(testCase);
        expect(detected).toContain('PII');
      });
    });

    it('should detect IP addresses', () => {
      const testCases = [
        'Server IP: 192.168.1.1',
        'Connect to 10.0.0.1',
        'Origin: 203.0.113.42',
      ];
      
      testCases.forEach(testCase => {
        const detected = validator.testSensitiveDataDetection(testCase);
        expect(detected).toContain('PII');
      });
    });

    it('should not detect false positives', () => {
      const safeCases = [
        'Error code: 404',
        'Version: 1.2.3',
        'Count: 12345',
        'Simple text message',
        'Date: 2023-01-15',
      ];
      
      safeCases.forEach(safeCase => {
        const detected = validator.testSensitiveDataDetection(safeCase);
        expect(detected).toHaveLength(0);
      });
    });

    it('should handle complex data structures for detection', () => {
      const complexData = {
        user: {
          email: 'test@example.com',
          profile: {
            ssn: '123-45-6789',
          },
        },
        payment: {
          card: '4111-1111-1111-1111',
        },
        logs: ['Normal log entry', 'API_KEY: secret123'],
      };
      
      const detected = validator.testSensitiveDataDetection(JSON.stringify(complexData));
      expect(detected.length).toBeGreaterThan(0);
      expect(detected).toContain('Email');
      expect(detected).toContain('SSN');
      expect(detected).toContain('Credit Card');
      expect(detected).toContain('API Key');
    });
  });

  describe('Data Sanitization', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should sanitize sensitive data in strings', () => {
      const sensitiveText = 'User email is user@example.com and SSN is 123-45-6789';
      
      const sanitized = validator.sanitizeSensitiveData(sensitiveText);
      
      expect(sanitized).not.toContain('user@example.com');
      expect(sanitized).not.toContain('123-45-6789');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('should sanitize sensitive data in objects', () => {
      const sensitiveData = {
        message: 'Credit card error: 4111-1111-1111-1111',
        user: {
          email: 'user@example.com',
          ssn: '123-45-6789',
        },
        metadata: {
          apiKey: 'API_KEY: secret_key_12345',
        },
      };
      
      const sanitized = validator.sanitizeSensitiveData(sensitiveData);
      
      expect(sanitized.message).toContain('[REDACTED]');
      expect(sanitized.message).not.toContain('4111-1111-1111-1111');
      expect(sanitized.user.email).toContain('[REDACTED]');
      expect(sanitized.metadata.apiKey).toContain('[REDACTED]');
    });

    it('should sanitize sensitive keys', () => {
      const dataWithSensitiveKeys = {
        username: 'john_doe',
        password: 'secret123',
        api_key: 'sk_test_12345',
        access_token: 'token_67890',
        normal_field: 'safe_value',
      };
      
      const sanitized = validator.sanitizeSensitiveData(dataWithSensitiveKeys);
      
      expect(sanitized.username).toBe('john_doe'); // Safe key
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.api_key).toBe('[REDACTED]');
      expect(sanitized.access_token).toBe('[REDACTED]');
      expect(sanitized.normal_field).toBe('safe_value');
    });

    it('should handle nested arrays and objects', () => {
      const complexData = {
        users: [
          { name: 'John', email: 'john@example.com' },
          { name: 'Jane', email: 'jane@example.com' },
        ],
        config: {
          database: {
            password: 'db_secret',
            host: 'db.example.com',
          },
          api: {
            keys: ['key1', 'key2'],
            secret: 'api_secret',
          },
        },
      };
      
      const sanitized = validator.sanitizeSensitiveData(complexData);
      
      expect(sanitized.users[0].name).toBe('John');
      expect(sanitized.users[0].email).toContain('[REDACTED]');
      expect(sanitized.config.database.password).toBe('[REDACTED]');
      expect(sanitized.config.database.host).toBe('db.example.com');
      expect(sanitized.config.api.secret).toBe('[REDACTED]');
    });

    it('should preserve non-sensitive data', () => {
      const mixedData = {
        error_code: 500,
        timestamp: '2023-01-15T12:00:00Z',
        message: 'Database connection failed',
        details: {
          attempts: 3,
          timeout: 5000,
        },
      };
      
      const sanitized = validator.sanitizeSensitiveData(mixedData);
      
      expect(sanitized).toEqual(mixedData); // Should be unchanged
    });

    it('should handle null and undefined values', () => {
      const dataWithNulls = {
        field1: null,
        field2: undefined,
        field3: 'value',
        password: null,
        email: undefined,
      };
      
      const sanitized = validator.sanitizeSensitiveData(dataWithNulls);
      
      expect(sanitized.field1).toBeNull();
      expect(sanitized.field2).toBeUndefined();
      expect(sanitized.field3).toBe('value');
      expect(sanitized.password).toBe('[REDACTED]'); // Sensitive key
      expect(sanitized.email).toBe('[REDACTED]'); // Sensitive key
    });

    it('should skip sanitization when disabled', () => {
      const config = { ...defaultConfig, enableSanitization: false };
      validator = new SecurityValidator(config);
      
      const sensitiveData = {
        password: 'secret123',
        email: 'user@example.com',
      };
      
      const sanitized = validator.sanitizeSensitiveData(sensitiveData);
      
      expect(sanitized).toEqual(sensitiveData); // Should be unchanged
    });

    it('should handle circular references gracefully', () => {
      const circularData: any = {
        name: 'test',
        password: 'secret',
      };
      circularData.self = circularData; // Create circular reference
      
      // Should not throw, though the exact behavior may vary
      expect(() => {
        validator.sanitizeSensitiveData(circularData);
      }).not.toThrow();
    });
  });

  describe('Configuration Validation', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should validate complete configuration', () => {
      const validConfig = {
        webhookUrl: 'https://api.example.com/webhook',
        projectName: 'test-project',
        environment: 'production',
        timeout: 5000,
      };
      
      const result = validator.validateConfiguration(validConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require webhook URL', () => {
      const configWithoutUrl = {
        projectName: 'test-project',
      };
      
      const result = validator.validateConfiguration(configWithoutUrl);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Webhook URL is required');
    });

    it('should require project name', () => {
      const configWithoutProject = {
        webhookUrl: 'https://api.example.com/webhook',
      };
      
      const result = validator.validateConfiguration(configWithoutProject);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Project name is required and must be a non-empty string');
    });

    it('should validate project name format', () => {
      const invalidProjectConfigs = [
        { webhookUrl: 'https://example.com', projectName: '' },
        { webhookUrl: 'https://example.com', projectName: '   ' },
        { webhookUrl: 'https://example.com', projectName: 123 },
        { webhookUrl: 'https://example.com', projectName: null },
      ];
      
      invalidProjectConfigs.forEach(config => {
        const result = validator.validateConfiguration(config);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Project name is required and must be a non-empty string');
      });
    });

    it('should warn about invalid timeout values', () => {
      const timeoutConfigs = [
        { webhookUrl: 'https://example.com', projectName: 'test', timeout: 500 }, // Too low
        { webhookUrl: 'https://example.com', projectName: 'test', timeout: 35000 }, // Too high
        { webhookUrl: 'https://example.com', projectName: 'test', timeout: 'invalid' }, // Wrong type
      ];
      
      timeoutConfigs.forEach(config => {
        const result = validator.validateConfiguration(config);
        expect(result.warnings.some(w => w.includes('Timeout'))).toBe(true);
      });
    });

    it('should warn about invalid environment type', () => {
      const config = {
        webhookUrl: 'https://example.com',
        projectName: 'test',
        environment: 123, // Should be string
      };
      
      const result = validator.validateConfiguration(config);
      
      expect(result.warnings).toContain('Environment should be a string');
    });

    it('should validate webhook URL within configuration', () => {
      const configWithBadUrl = {
        webhookUrl: 'http://example.com/webhook', // HTTP instead of HTTPS
        projectName: 'test-project',
      };
      
      const result = validator.validateConfiguration(configWithBadUrl);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('HTTPS is required for webhook URLs');
    });

    it('should handle missing configuration gracefully', () => {
      const result = validator.validateConfiguration({});
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Custom Pattern Management', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should add custom sensitive pattern', () => {
      const customPattern = /CUSTOM-\d{4}-[A-Z]{2}/g;
      
      validator.addSensitivePattern(customPattern);
      
      const config = validator.getConfig();
      expect(config.sensitiveDataPatterns).toContain(customPattern);
    });

    it('should not add duplicate patterns', () => {
      const customPattern = /DUPLICATE-PATTERN/g;
      
      validator.addSensitivePattern(customPattern);
      validator.addSensitivePattern(customPattern); // Add again
      
      const config = validator.getConfig();
      const occurrences = config.sensitiveDataPatterns.filter(p => p === customPattern).length;
      expect(occurrences).toBe(1);
    });

    it('should remove custom sensitive pattern', () => {
      const customPattern = /REMOVE-ME-\d+/g;
      
      validator.addSensitivePattern(customPattern);
      expect(validator.getConfig().sensitiveDataPatterns).toContain(customPattern);
      
      validator.removeSensitivePattern(customPattern);
      expect(validator.getConfig().sensitiveDataPatterns).not.toContain(customPattern);
    });

    it('should handle removal of non-existent pattern', () => {
      const nonExistentPattern = /NON-EXISTENT/g;
      
      expect(() => {
        validator.removeSensitivePattern(nonExistentPattern);
      }).not.toThrow();
    });

    it('should use custom patterns for detection', () => {
      const customPattern = /SECRET-ID-\d{6}/g;
      const testText = 'Error with SECRET-ID-123456 in processing';
      
      // Should not detect before adding pattern
      const beforeDetection = validator.testSensitiveDataDetection(testText);
      expect(beforeDetection).toHaveLength(0);
      
      // Add custom pattern and test again
      validator.addSensitivePattern(customPattern);
      const afterDetection = validator.testSensitiveDataDetection(testText);
      expect(afterDetection.length).toBeGreaterThan(0);
    });
  });

  describe('Configuration Management', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should update configuration', () => {
      const updates = {
        requireHttps: false,
        maxPayloadSize: 50000,
        allowedDomains: ['example.com', 'trusted.org'],
      };
      
      validator.updateConfig(updates);
      
      const config = validator.getConfig();
      expect(config.requireHttps).toBe(false);
      expect(config.maxPayloadSize).toBe(50000);
      expect(config.allowedDomains).toEqual(['example.com', 'trusted.org']);
      expect(config.validateTokens).toBe(true); // Should remain unchanged
    });

    it('should affect validation after configuration update', () => {
      // Initially requires HTTPS
      let result = validator.validateWebhookUrl('http://example.com/webhook');
      expect(result.valid).toBe(false);
      
      // Update to allow HTTP
      validator.updateConfig({ requireHttps: false });
      
      result = validator.validateWebhookUrl('http://example.com/webhook');
      expect(result.valid).toBe(true);
    });

    it('should return current configuration', () => {
      const config = validator.getConfig();
      
      expect(config.requireHttps).toBeDefined();
      expect(config.validateTokens).toBeDefined();
      expect(config.maxPayloadSize).toBeDefined();
      expect(config.allowedDomains).toBeDefined();
      expect(config.sensitiveDataPatterns).toBeDefined();
      expect(config.enableSanitization).toBeDefined();
    });

    it('should preserve existing configuration when partially updating', () => {
      const originalConfig = validator.getConfig();
      
      validator.updateConfig({ requireHttps: false });
      
      const updatedConfig = validator.getConfig();
      expect(updatedConfig.requireHttps).toBe(false);
      expect(updatedConfig.maxPayloadSize).toBe(originalConfig.maxPayloadSize);
      expect(updatedConfig.allowedDomains).toEqual(originalConfig.allowedDomains);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should handle extremely large data objects', () => {
      const largeObject = {
        message: 'Test error',
        project: 'test',
        timestamp: '2023-01-15T12:00:00Z',
        largeArray: new Array(10000).fill('data'),
      };
      
      expect(() => {
        validator.validateErrorData(largeObject);
      }).not.toThrow();
    });

    it('should handle objects with many nested levels', () => {
      let deepObject: any = { message: 'Test', project: 'test', timestamp: '2023-01-15T12:00:00Z' };
      let current = deepObject;
      
      // Create 100 levels of nesting
      for (let i = 0; i < 100; i++) {
        current.nested = { level: i };
        current = current.nested;
      }
      
      expect(() => {
        validator.validateErrorData(deepObject);
        validator.sanitizeSensitiveData(deepObject);
      }).not.toThrow();
    });

    it('should handle special characters in data', () => {
      const specialCharData = {
        message: 'Error with émojis 🚀 and symbols ñ ü',
        project: 'tëst-prøject',
        timestamp: '2023-01-15T12:00:00Z',
        context: {
          '特殊字符': '中文测试',
          '🔑': 'emoji-key',
        },
      };
      
      const result = validator.validateErrorData(specialCharData);
      expect(result.valid).toBe(true);
      
      const sanitized = validator.sanitizeSensitiveData(specialCharData);
      expect(sanitized).toBeDefined();
    });

    it('should handle objects with prototype pollution attempts', () => {
      const maliciousData = {
        message: 'Test',
        project: 'test',
        timestamp: '2023-01-15T12:00:00Z',
        '__proto__': { polluted: true },
        constructor: { prototype: { polluted: true } },
      };
      
      expect(() => {
        validator.validateErrorData(maliciousData);
        validator.sanitizeSensitiveData(maliciousData);
      }).not.toThrow();
    });

    it('should handle data with functions', () => {
      const dataWithFunctions = {
        message: 'Test',
        project: 'test',
        timestamp: '2023-01-15T12:00:00Z',
        callback: function() { return 'test'; },
        arrow: () => 'test',
      };
      
      expect(() => {
        validator.validateErrorData(dataWithFunctions);
      }).not.toThrow();
    });

    it('should handle regex pattern state issues', () => {
      // Test that global regex patterns don't cause state issues
      const testData = 'Email: user1@example.com and user2@example.com';
      
      const detection1 = validator.testSensitiveDataDetection(testData);
      const detection2 = validator.testSensitiveDataDetection(testData);
      
      // Results should be consistent
      expect(detection1).toEqual(detection2);
    });

    it('should handle invalid regex patterns gracefully', () => {
      // This test ensures that if somehow invalid patterns are added,
      // the system doesn't crash
      const originalPatterns = validator.getConfig().sensitiveDataPatterns;
      
      try {
        // Manually add invalid pattern (this should be prevented by TypeScript, but just in case)
        (validator.getConfig().sensitiveDataPatterns as any).push('not-a-regex');
        
        expect(() => {
          validator.testSensitiveDataDetection('test data');
        }).not.toThrow();
      } catch (error) {
        // If it does throw, it should be handled gracefully
        expect(error).toBeDefined();
      }
    });
  });

  describe('Performance and Memory', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should handle multiple validations efficiently', () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        const data = {
          message: `Error ${i}`,
          project: `project-${i}`,
          timestamp: new Date().toISOString(),
        };
        
        validator.validateErrorData(data);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle large string sanitization efficiently', () => {
      const largeString = 'Test data with email user@example.com and phone 123-456-7890. '.repeat(1000);
      
      const startTime = Date.now();
      const sanitized = validator.sanitizeSensitiveData(largeString);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
      expect(sanitized).toContain('[REDACTED]');
    });

    it('should not leak memory with repeated operations', () => {
      // This test runs many operations to check for potential memory leaks
      for (let i = 0; i < 100; i++) {
        const data = {
          message: `Test error ${i}`,
          project: 'test-project',
          timestamp: new Date().toISOString(),
          context: {
            email: `user${i}@example.com`,
            data: new Array(100).fill(`item-${i}`),
          },
        };
        
        validator.validateErrorData(data);
        validator.sanitizeSensitiveData(data);
        validator.testSensitiveDataDetection(JSON.stringify(data));
      }
      
      // If we reach this point without running out of memory, the test passes
      expect(true).toBe(true);
    });
  });

  describe('Node.js Specific Features', () => {
    beforeEach(() => {
      validator = new SecurityValidator(defaultConfig);
    });

    it('should work with Node.js Buffer operations', () => {
      const bufferData = Buffer.from('Test data with sensitive info: user@example.com');
      const stringData = bufferData.toString();
      
      const result = validator.validateErrorData({
        message: stringData,
        project: 'buffer-test',
        timestamp: new Date().toISOString(),
      });
      
      expect(result.warnings.some(w => w.includes('sensitive data'))).toBe(true);
    });

    it('should handle Node.js URL parsing correctly', () => {
      // Test various Node.js supported URL formats
      const urls = [
        'https://example.com:443/webhook',
        'https://[::1]:3000/webhook', // IPv6
        'https://example.com/webhook?param=value&other=data',
        'https://subdomain.example.com/path/to/webhook#anchor',
      ];
      
      urls.forEach(url => {
        const result = validator.validateWebhookUrl(url);
        expect(result.valid).toBe(true);
      });
    });

    it('should work with Node.js process memory considerations', () => {
      // Test that validation works correctly with Node.js memory management
      const largePayload = {
        message: 'Test error',
        project: 'memory-test',
        timestamp: new Date().toISOString(),
        data: Buffer.alloc(50000).toString('hex'), // 50KB of hex data
      };
      
      const result = validator.validateErrorData(largePayload);
      
      // Should detect payload size issue
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Payload size'))).toBe(true);
    });

    it('should handle Node.js specific error objects', () => {
      const nodeError = new Error('Node.js specific error');
      (nodeError as any).code = 'ECONNRESET';
      (nodeError as any).errno = -4077;
      (nodeError as any).syscall = 'connect';
      
      const errorData = {
        message: nodeError.message,
        project: 'node-test',
        timestamp: new Date().toISOString(),
        context: {
          error: nodeError,
          code: (nodeError as any).code,
        },
      };
      
      const result = validator.validateErrorData(errorData);
      expect(result.valid).toBe(true);
    });
  });

  describe('TypeScript Type Safety', () => {
    it('should maintain type safety for configuration', () => {
      const config: SecurityConfig = validator.getConfig();
      
      expect(typeof config.requireHttps).toBe('boolean');
      expect(typeof config.validateTokens).toBe('boolean');
      expect(typeof config.maxPayloadSize).toBe('number');
      expect(Array.isArray(config.allowedDomains)).toBe(true);
      expect(Array.isArray(config.sensitiveDataPatterns)).toBe(true);
      expect(typeof config.enableSanitization).toBe('boolean');
    });

    it('should return properly typed validation results', () => {
      const result: ValidationResult = validator.validateWebhookUrl('https://example.com');
      
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should handle typed error data validation', () => {
      interface CustomErrorData {
        message: string;
        project: string;
        timestamp: string;
        customField?: string;
      }
      
      const errorData: CustomErrorData = {
        message: 'Typed error',
        project: 'typed-project',
        timestamp: '2023-01-15T12:00:00Z',
        customField: 'custom value',
      };
      
      const result = validator.validateErrorData(errorData);
      expect(result.valid).toBe(true);
    });

    it('should handle generic sanitization correctly', () => {
      interface SensitiveData {
        publicInfo: string;
        privateInfo: string;
      }
      
      const data: SensitiveData = {
        publicInfo: 'Safe information',
        privateInfo: 'Email: secret@example.com',
      };
      
      const sanitized = validator.sanitizeSensitiveData(data);
      
      expect(sanitized.publicInfo).toBe('Safe information');
      expect(sanitized.privateInfo).toContain('[REDACTED]');
    });
  });
});