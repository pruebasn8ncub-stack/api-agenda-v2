import type { FastifyInstance } from 'fastify';
import { sendSuccess, sendError } from '../lib/response.js';

export default async function servicesRoutes(app: FastifyInstance) {

    /**
     * GET /api/v1/services — List active services
     */
    app.get('/api/v1/services', async (request, reply) => {
        try {
            const { data, error } = await app.supabase
                .from('services')
                .select('*')
                .eq('is_active', true)
                .order('name', { ascending: true });

            if (error) throw error;
            return sendSuccess(reply, data);
        } catch (err) {
            return sendError(reply, err);
        }
    });

    /**
     * GET /api/v1/services/:id — Service detail with phases
     */
    app.get('/api/v1/services/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const { data: service, error: sErr } = await app.supabase
                .from('services')
                .select('*')
                .eq('id', id)
                .single();

            if (sErr || !service) {
                return sendError(reply, { statusCode: 404, code: 'SERVICE_NOT_FOUND', message: 'Servicio no encontrado' });
            }

            const { data: phases } = await app.supabase
                .from('service_phases')
                .select('*')
                .eq('service_id', id)
                .order('phase_order', { ascending: true });

            return sendSuccess(reply, { ...service, phases: phases ?? [] });
        } catch (err) {
            return sendError(reply, err);
        }
    });
}
