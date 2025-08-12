"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BreadcrumbManager = void 0;
class BreadcrumbManager {
    constructor(maxBreadcrumbs = 50) {
        this.breadcrumbs = [];
        this.maxBreadcrumbs = maxBreadcrumbs;
    }
    addBreadcrumb(breadcrumb) {
        const fullBreadcrumb = {
            ...breadcrumb,
            timestamp: new Date().toISOString(),
        };
        this.breadcrumbs.push(fullBreadcrumb);
        if (this.breadcrumbs.length > this.maxBreadcrumbs) {
            this.breadcrumbs.shift();
        }
    }
    getBreadcrumbs() {
        return [...this.breadcrumbs];
    }
    clear() {
        this.breadcrumbs = [];
    }
    addHttpRequest(method, url, statusCode) {
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
    addConsoleLog(level, message, data) {
        this.addBreadcrumb({
            message,
            category: 'console',
            level: level,
            data: data ? { data } : undefined,
        });
    }
    addQuery(query, duration) {
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
    addNavigation(from, to) {
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
    addCustom(message, data) {
        this.addBreadcrumb({
            message,
            category: 'custom',
            level: 'info',
            data,
        });
    }
    logNavigation(from, to) {
        this.addNavigation(from, to);
    }
    logUserAction(action, data) {
        this.addBreadcrumb({
            message: `User action: ${action}`,
            category: 'user',
            level: 'info',
            data,
        });
    }
    logHttpRequest(method, url, statusCode) {
        this.addHttpRequest(method, url, statusCode);
    }
    clearBreadcrumbs() {
        this.clear();
    }
    getMaxBreadcrumbs() {
        return this.maxBreadcrumbs;
    }
}
exports.BreadcrumbManager = BreadcrumbManager;
//# sourceMappingURL=BreadcrumbManager.js.map