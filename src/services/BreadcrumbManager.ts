import { Breadcrumb } from '../types';

export class BreadcrumbManager {
  private breadcrumbs: Breadcrumb[] = [];
  private maxBreadcrumbs: number;

  constructor(maxBreadcrumbs: number = 50) {
    this.maxBreadcrumbs = maxBreadcrumbs;
  }

  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
    const fullBreadcrumb: Breadcrumb = {
      ...breadcrumb,
      timestamp: new Date().toISOString(),
    };

    this.breadcrumbs.push(fullBreadcrumb);

    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  getBreadcrumbs(): Breadcrumb[] {
    return [...this.breadcrumbs];
  }

  clear(): void {
    this.breadcrumbs = [];
  }

  addHttpRequest(method: string, url: string, statusCode?: number): void {
    this.addBreadcrumb({
      message: `${method} ${url}${statusCode ? ` → ${statusCode}` : ''}`,
      category: 'http',
      level: statusCode && statusCode >= 400 ? 'error' : 'info',
      data: {
        method,
        url,
        status_code: statusCode,
      },
    });
  }

  addConsoleLog(level: string, message: string, data?: any): void {
    this.addBreadcrumb({
      message,
      category: 'console',
      level: level as any,
      data: data ? { data } : undefined,
    });
  }

  addQuery(query: string, duration?: number): void {
    this.addBreadcrumb({
      message: `Query: ${query.substring(0, 100)}${query.length > 100 ? '...' : ''}`,
      category: 'query',
      level: 'info',
      data: {
        query,
        duration,
      },
    });
  }

  addNavigation(from: string, to: string): void {
    this.addBreadcrumb({
      message: `Navigation: ${from} → ${to}`,
      category: 'navigation',
      level: 'info',
      data: {
        from,
        to,
      },
    });
  }

  addCustom(message: string, data?: Record<string, any>): void {
    this.addBreadcrumb({
      message,
      category: 'custom',
      level: 'info',
      data,
    });
  }

  // Alias methods for compatibility
  logNavigation(from: string, to: string): void {
    this.addNavigation(from, to);
  }

  logUserAction(action: string, data?: Record<string, any>): void {
    this.addBreadcrumb({
      message: `User action: ${action}`,
      category: 'user',
      level: 'info',
      data,
    });
  }

  logHttpRequest(method: string, url: string, statusCode?: number): void {
    this.addHttpRequest(method, url, statusCode);
  }

  clearBreadcrumbs(): void {
    this.clear();
  }

  getMaxBreadcrumbs(): number {
    return this.maxBreadcrumbs;
  }
}
