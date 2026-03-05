import fp from 'fastify-plugin';
import { getEnv } from '../config/env.js';

export default fp(async (fastify) => {
    const env = getEnv();

    fastify.addHook('onRequest', async (request, reply) => {
        // Skip auth for health check
        if (request.url === '/health') return;

        const apiKey = request.headers['x-api-key'];

        if (!apiKey || apiKey !== env.API_KEY) {
            reply.status(401).send({
                success: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'API key inválida o ausente',
                },
            });
        }
    });
}, { name: 'auth' });
