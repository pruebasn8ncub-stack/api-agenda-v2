import type { FastifyInstance } from 'fastify';
import { AvailabilityEngine } from '../services/availability.engine.js';
import { getAvailabilitySlotsQuery, getSmartAvailabilityQuery } from '../schemas/index.js';
import { sendSuccess, sendError } from '../lib/response.js';
import { AppError } from '../lib/errors.js';

export default async function availabilityRoutes(app: FastifyInstance) {

    /**
     * GET /api/v1/availability/slots?service_id=X&date=YYYY-MM-DD
     * GET /api/v1/availability/slots?service_id=X&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
     */
    app.get('/api/v1/availability/slots', async (request, reply) => {
        try {
            const query = getAvailabilitySlotsQuery.parse(request.query);

            if (query.date) {
                const slots = await AvailabilityEngine.getAvailableSlots(
                    app.supabase,
                    query.service_id,
                    query.date,
                );
                return sendSuccess(reply, { date: query.date, slots, total: slots.length });
            }

            // Multi-day range
            const allSlots: Record<string, string[]> = {};
            const start = new Date(`${query.start_date}T12:00:00Z`);
            const end = new Date(`${query.end_date}T12:00:00Z`);

            const current = new Date(start);
            while (current <= end) {
                const dateStr = current.toISOString().split('T')[0]!;
                allSlots[dateStr] = await AvailabilityEngine.getAvailableSlots(
                    app.supabase,
                    query.service_id,
                    dateStr,
                );
                current.setUTCDate(current.getUTCDate() + 1);
            }

            return sendSuccess(reply, {
                start_date: query.start_date,
                end_date: query.end_date,
                slots_by_date: allSlots,
            });
        } catch (err) {
            if (err instanceof AppError) return sendError(reply, err);
            if (err && typeof err === 'object' && 'issues' in err) {
                return sendError(reply, new AppError('Parámetros inválidos', 400, 'VALIDATION_ERROR', (err as any).issues));
            }
            return sendError(reply, err);
        }
    });

    /**
     * GET /api/v1/availability/smart?service_id=X&date=YYYY-MM-DD
     * AI-optimized response with natural language hints.
     */
    app.get('/api/v1/availability/smart', async (request, reply) => {
        try {
            const query = getSmartAvailabilityQuery.parse(request.query);
            const result = await AvailabilityEngine.getSmartAvailability(
                app.supabase,
                query.service_id,
                query.date,
            );
            return sendSuccess(reply, result);
        } catch (err) {
            if (err instanceof AppError) return sendError(reply, err);
            if (err && typeof err === 'object' && 'issues' in err) {
                return sendError(reply, new AppError('Parámetros inválidos', 400, 'VALIDATION_ERROR', (err as any).issues));
            }
            return sendError(reply, err);
        }
    });
}
