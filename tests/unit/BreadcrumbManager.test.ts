import { BreadcrumbManager } from '../../src/services/BreadcrumbManager';

describe('BreadcrumbManager', () => {
  let breadcrumbManager: BreadcrumbManager;

  beforeEach(() => {
    breadcrumbManager = new BreadcrumbManager();
  });

  describe('addBreadcrumb', () => {
    it('should add a breadcrumb with all properties', () => {
      breadcrumbManager.addBreadcrumb({
        message: 'Test message',
        category: 'custom',
        level: 'info',
      });

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(1);
      expect(breadcrumbs[0]).toMatchObject({
        message: 'Test message',
        category: 'custom',
        level: 'info',
        timestamp: expect.any(String),
      });
    });

    it('should maintain chronological order', () => {
      breadcrumbManager.addBreadcrumb({ message: 'First', category: 'custom', level: 'info' });
      breadcrumbManager.addBreadcrumb({ message: 'Second', category: 'custom', level: 'info' });
      breadcrumbManager.addBreadcrumb({ message: 'Third', category: 'custom', level: 'info' });

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs[0].message).toBe('First');
      expect(breadcrumbs[1].message).toBe('Second');
      expect(breadcrumbs[2].message).toBe('Third');
    });

    it('should limit breadcrumbs to maxBreadcrumbs', () => {
      const smallManager = new BreadcrumbManager(3);

      for (let i = 1; i <= 5; i++) {
        smallManager.addBreadcrumb({
          message: `Breadcrumb ${i}`,
          category: 'custom',
          level: 'info',
        });
      }

      const breadcrumbs = smallManager.getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(3);
      expect(breadcrumbs[0].message).toBe('Breadcrumb 3');
      expect(breadcrumbs[1].message).toBe('Breadcrumb 4');
      expect(breadcrumbs[2].message).toBe('Breadcrumb 5');
    });
  });

  describe('clear', () => {
    it('should remove all breadcrumbs', () => {
      breadcrumbManager.addBreadcrumb({ message: 'Test 1', category: 'custom', level: 'info' });
      breadcrumbManager.addBreadcrumb({ message: 'Test 2', category: 'custom', level: 'info' });
      expect(breadcrumbManager.getBreadcrumbs()).toHaveLength(2);

      breadcrumbManager.clear();
      expect(breadcrumbManager.getBreadcrumbs()).toHaveLength(0);
    });
  });

  describe('getBreadcrumbs', () => {
    it('should return a copy of breadcrumbs array', () => {
      breadcrumbManager.addBreadcrumb({ message: 'Test', category: 'custom', level: 'info' });

      const breadcrumbs1 = breadcrumbManager.getBreadcrumbs();
      const breadcrumbs2 = breadcrumbManager.getBreadcrumbs();

      expect(breadcrumbs1).not.toBe(breadcrumbs2);
      expect(breadcrumbs1).toEqual(breadcrumbs2);
    });

    it('should return empty array when no breadcrumbs', () => {
      expect(breadcrumbManager.getBreadcrumbs()).toEqual([]);
    });
  });

  describe('addHttpRequest', () => {
    it('should add HTTP request breadcrumb', () => {
      breadcrumbManager.addHttpRequest('GET', '/api/users', 200);

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs[0]).toMatchObject({
        message: 'GET /api/users → 200',
        category: 'http',
        level: 'info',
        data: {
          method: 'GET',
          url: '/api/users',
          status_code: 200,
        },
      });
    });

    it('should mark failed requests as error level', () => {
      breadcrumbManager.addHttpRequest('POST', '/api/users', 500);

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs[0].level).toBe('error');
    });
  });

  describe('addConsoleLog', () => {
    it('should add console log breadcrumb', () => {
      breadcrumbManager.addConsoleLog('warn', 'Warning message', { extra: 'data' });

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs[0]).toMatchObject({
        message: 'Warning message',
        category: 'console',
        level: 'warn',
        data: { data: { extra: 'data' } },
      });
    });
  });

  describe('addQuery', () => {
    it('should add query breadcrumb', () => {
      breadcrumbManager.addQuery('SELECT * FROM users', 125);

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs[0]).toMatchObject({
        message: 'Query: SELECT * FROM users',
        category: 'query',
        level: 'info',
        data: {
          query: 'SELECT * FROM users',
          duration: 125,
        },
      });
    });

    it('should truncate long queries', () => {
      const longQuery = 'SELECT ' + 'a'.repeat(200) + ' FROM users';
      breadcrumbManager.addQuery(longQuery);

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs[0].message).toMatch(/\.\.\.$/);
      expect(breadcrumbs[0].message.length).toBeLessThanOrEqual(110);
    });
  });

  describe('addNavigation', () => {
    it('should add navigation breadcrumb', () => {
      breadcrumbManager.addNavigation('/home', '/profile');

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs[0]).toMatchObject({
        message: 'Navigation: /home → /profile',
        category: 'navigation',
        level: 'info',
        data: {
          from: '/home',
          to: '/profile',
        },
      });
    });
  });

  describe('addCustom', () => {
    it('should add custom breadcrumb', () => {
      breadcrumbManager.addCustom('Custom event', { userId: 123 });

      const breadcrumbs = breadcrumbManager.getBreadcrumbs();
      expect(breadcrumbs[0]).toMatchObject({
        message: 'Custom event',
        category: 'custom',
        level: 'info',
        data: { userId: 123 },
      });
    });
  });
});
