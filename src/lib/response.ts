import type { FastifyReply } from 'fastify';
import type { ApiResponse } from '../types/index.js';
import { AppError } from './errors.js';

export function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200): void {
    const response: ApiResponse<T> = { success: true, data };
    reply.status(statusCode).send(response);
}

export function sendCreated<T>(reply: FastifyReply, data: T): void {
    sendSuccess(reply, data, 201);
}

export function sendNoContent(reply: FastifyReply): void {
    reply.status(204).send();
}

export function sendError(reply: FastifyReply, error: unknown): void {
    if (error instanceof AppError) {
        const response: ApiResponse = {
            success: false,
            error: {
                code: error.code,
                message: error.message,
                details: error.details,
            },
        };
        reply.status(error.statusCode).send(response);
        return;
    }

    // Unknown error — don't leak internals
    const message = error instanceof Error ? error.message : 'Error interno del servidor';
    console.error('[UNHANDLED ERROR]', error);

    const response: ApiResponse = {
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message,
        },
    };
    reply.status(500).send(response);
}
