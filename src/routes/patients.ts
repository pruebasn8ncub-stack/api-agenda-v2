import type { FastifyInstance } from 'fastify';
import { PatientsService } from '../services/patients.service.js';
import {
    createPatientBody,
    updatePatientBody,
    searchPatientsQuery,
    uuidParam,
} from '../schemas/index.js';
import { sendSuccess, sendCreated, sendError } from '../lib/response.js';
import { AppError } from '../lib/errors.js';

export default async function patientsRoutes(app: FastifyInstance) {

    /**
     * GET /api/v1/patients?search=name
     */
    app.get('/api/v1/patients', async (request, reply) => {
        try {
            const { search } = searchPatientsQuery.parse(request.query);
            const data = await PatientsService.getPatients(app.supabase, search);
            return sendSuccess(reply, data);
        } catch (err) {
            return sendError(reply, err);
        }
    });

    /**
     * GET /api/v1/patients/:id
     */
    app.get('/api/v1/patients/:id', async (request, reply) => {
        try {
            const { id } = uuidParam.parse(request.params);
            const data = await PatientsService.getPatientById(app.supabase, id);
            return sendSuccess(reply, data);
        } catch (err) {
            return sendError(reply, err);
        }
    });

    /**
     * POST /api/v1/patients
     */
    app.post('/api/v1/patients', async (request, reply) => {
        try {
            const body = createPatientBody.parse(request.body);
            const data = await PatientsService.createPatient(app.supabase, body);
            return sendCreated(reply, data);
        } catch (err) {
            if (err && typeof err === 'object' && 'issues' in err) {
                return sendError(reply, new AppError('Datos inválidos', 400, 'VALIDATION_ERROR', (err as any).issues));
            }
            return sendError(reply, err);
        }
    });

    /**
     * PATCH /api/v1/patients/:id
     */
    app.patch('/api/v1/patients/:id', async (request, reply) => {
        try {
            const { id } = uuidParam.parse(request.params);
            const body = updatePatientBody.parse(request.body);
            const data = await PatientsService.updatePatient(app.supabase, id, body);
            return sendSuccess(reply, data);
        } catch (err) {
            if (err && typeof err === 'object' && 'issues' in err) {
                return sendError(reply, new AppError('Datos inválidos', 400, 'VALIDATION_ERROR', (err as any).issues));
            }
            return sendError(reply, err);
        }
    });
}
