import type { FastifyInstance } from 'fastify';
import { AppointmentsService } from '../services/appointments.service.js';
import {
    createAppointmentBody,
    updateAppointmentBody,
    appointmentsFilterQuery,
    uuidParam,
} from '../schemas/index.js';
import { sendSuccess, sendCreated, sendNoContent, sendError } from '../lib/response.js';
import { AppError } from '../lib/errors.js';

export default async function appointmentsRoutes(app: FastifyInstance) {

    /**
     * GET /api/v1/appointments
     */
    app.get('/api/v1/appointments', async (request, reply) => {
        try {
            const filters = appointmentsFilterQuery.parse(request.query);
            const data = await AppointmentsService.getAppointments(app.supabase, {
                professionalId: filters.professional_id,
                startDate: filters.start_date,
                endDate: filters.end_date,
            });
            return sendSuccess(reply, data);
        } catch (err) {
            return sendError(reply, err);
        }
    });

    /**
     * POST /api/v1/appointments
     */
    app.post('/api/v1/appointments', async (request, reply) => {
        try {
            const body = createAppointmentBody.parse(request.body);
            const data = await AppointmentsService.createAppointment(app.supabase, body);
            return sendCreated(reply, data);
        } catch (err) {
            if (err && typeof err === 'object' && 'issues' in err) {
                return sendError(reply, new AppError('Datos inválidos', 400, 'VALIDATION_ERROR', (err as any).issues));
            }
            return sendError(reply, err);
        }
    });

    /**
     * PATCH /api/v1/appointments/:id
     */
    app.patch('/api/v1/appointments/:id', async (request, reply) => {
        try {
            const { id } = uuidParam.parse(request.params);
            const body = updateAppointmentBody.parse(request.body);
            const data = await AppointmentsService.updateAppointment(app.supabase, id, body);
            return sendSuccess(reply, data);
        } catch (err) {
            if (err && typeof err === 'object' && 'issues' in err) {
                return sendError(reply, new AppError('Datos inválidos', 400, 'VALIDATION_ERROR', (err as any).issues));
            }
            return sendError(reply, err);
        }
    });

    /**
     * DELETE /api/v1/appointments/:id (cancel)
     */
    app.delete('/api/v1/appointments/:id', async (request, reply) => {
        try {
            const { id } = uuidParam.parse(request.params);
            await AppointmentsService.cancelAppointment(app.supabase, id);
            return sendNoContent(reply);
        } catch (err) {
            return sendError(reply, err);
        }
    });
}
