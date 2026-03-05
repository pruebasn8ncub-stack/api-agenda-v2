import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import supabasePlugin from './plugins/supabase.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import availabilityRoutes from './routes/availability.js';
import appointmentsRoutes from './routes/appointments.js';
import patientsRoutes from './routes/patients.js';
import servicesRoutes from './routes/services.js';
import professionalsRoutes from './routes/professionals.js';
import { getEnv } from './config/env.js';

export async function buildApp() {
    const env = getEnv();

    const app = Fastify({
        logger: {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            transport: env.NODE_ENV !== 'production'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
        },
    });

    // ── Plugins ──────────────────────────────────────────────────────
    await app.register(cors, {
        origin: env.CORS_ORIGINS === '*'
            ? true
            : env.CORS_ORIGINS.split(',').map(s => s.trim()),
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    });

    await app.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
    });

    await app.register(supabasePlugin);
    await app.register(authPlugin);

    // ── Routes ───────────────────────────────────────────────────────
    await app.register(healthRoutes);
    await app.register(availabilityRoutes);
    await app.register(appointmentsRoutes);
    await app.register(patientsRoutes);
    await app.register(servicesRoutes);
    await app.register(professionalsRoutes);

    return app;
}
