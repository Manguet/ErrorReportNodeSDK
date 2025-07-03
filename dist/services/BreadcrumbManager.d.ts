import { Breadcrumb } from '../types';
export declare class BreadcrumbManager {
    private breadcrumbs;
    private maxBreadcrumbs;
    constructor(maxBreadcrumbs?: number);
    addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void;
    getBreadcrumbs(): Breadcrumb[];
    clear(): void;
    addHttpRequest(method: string, url: string, statusCode?: number): void;
    addConsoleLog(level: string, message: string, data?: any): void;
    addQuery(query: string, duration?: number): void;
    addNavigation(from: string, to: string): void;
    addCustom(message: string, data?: Record<string, any>): void;
}
//# sourceMappingURL=BreadcrumbManager.d.ts.map