/**
 * Application error with HTTP status code and machine-readable error code.
 */
export class AppError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 500,
        public readonly code: string = 'INTERNAL_ERROR',
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'AppError';
    }
}
