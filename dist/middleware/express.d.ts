import { Request, Response, NextFunction } from 'express';
import { ErrorReporter } from '../services/ErrorReporter';
import { ExpressOptions } from '../types';
export declare function createExpressErrorHandler(errorReporter: ErrorReporter, options?: ExpressOptions): (error: Error, req: Request, res: Response, next: NextFunction) => void;
export declare function createExpressRequestLogger(errorReporter: ErrorReporter, options?: ExpressOptions): (req: Request, res: Response, next: NextFunction) => void;
export declare function setupExpressIntegration(app: any, errorReporter: ErrorReporter, options?: ExpressOptions): void;
//# sourceMappingURL=express.d.ts.map