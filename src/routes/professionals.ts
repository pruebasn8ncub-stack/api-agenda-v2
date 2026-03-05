import type { FastifyInstance } from 'fastify';
import { sendSuccess, sendError } from '../lib/response.js';

export default async function professionalsRoutes(app: FastifyInstance) {

    /**
     * GET /api/v1/professionals — List professionals with schedules
     */
    app.get('/api/v1/professionals', async (request, reply) => {
        try {
            const { data: professionals, error: pErr } = await app.supabase
                .from('profiles')
                .select('id, full_name, role')
                .eq('role', 'professional');

            if (pErr) throw pErr;

            const { data: schedules, error: sErr } = await app.supabase
                .from('professional_schedules')
                .select('*');

            if (sErr) throw sErr;

            // Join in memory (simple and fast)
            const result = (professionals ?? []).map(p => ({
                ...p,
                schedules: (schedules ?? []).filter(s => s.professional_id === p.id),
            }));

            return sendSuccess(reply, result);
        } catch (err) {
            return sendError(reply, err);
        }
    });
}
