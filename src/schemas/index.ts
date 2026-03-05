import { z } from 'zod';

// ── Common ──────────────────────────────────────────────────────────

export const uuidParam = z.object({
    id: z.string().uuid('ID debe ser un UUID válido'),
});

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)');

// ── Availability ────────────────────────────────────────────────────

export const getAvailabilitySlotsQuery = z.object({
    service_id: z.string().uuid('service_id debe ser un UUID'),
    date: dateString.optional(),
    start_date: dateString.optional(),
    end_date: dateString.optional(),
}).refine(
    (data) => data.date || (data.start_date && data.end_date),
    { message: 'Debes enviar `date` o `start_date` + `end_date`' },
);

export const getSmartAvailabilityQuery = z.object({
    service_id: z.string().uuid('service_id debe ser un UUID'),
    date: dateString,
});

// ── Appointments ────────────────────────────────────────────────────

export const createAppointmentBody = z.object({
    patient_id: z.string().uuid(),
    service_id: z.string().uuid(),
    starts_at: z.string().datetime({ message: 'starts_at debe ser ISO 8601' }),
    notes: z.string().optional(),
});

export const updateAppointmentBody = z.object({
    starts_at: z.string().datetime().optional(),
    service_id: z.string().uuid().optional(),
    notes: z.string().optional(),
    status: z.enum(['scheduled', 'cancelled', 'completed', 'no_show']).optional(),
});

export const appointmentsFilterQuery = z.object({
    professional_id: z.string().uuid().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
});

// ── Patients ────────────────────────────────────────────────────────

export const createPatientBody = z.object({
    full_name: z.string().min(2, 'Nombre demasiado corto'),
    phone: z.string().min(6, 'Teléfono inválido'),
    email: z.string().email('Email inválido').optional(),
    notes: z.string().optional(),
});

export const updatePatientBody = z.object({
    full_name: z.string().min(2).optional(),
    phone: z.string().min(6).optional(),
    email: z.string().email().optional(),
    notes: z.string().optional(),
});

export const searchPatientsQuery = z.object({
    search: z.string().optional(),
});
