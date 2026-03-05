import type { SupabaseClient } from '@supabase/supabase-js';
import { parseISO, isBefore } from 'date-fns';
import { AppError } from '../lib/errors.js';
import { AvailabilityEngine } from './availability.engine.js';
import type { Appointment, CreateAppointmentDTO, RescheduleAppointmentDTO } from '../types/index.js';

export class AppointmentsService {

    /**
     * Fetch appointments with optional filters.
     */
    static async getAppointments(
        supabase: SupabaseClient,
        filters: { professionalId?: string; startDate?: string; endDate?: string },
    ): Promise<Appointment[]> {
        let query = supabase
            .from('appointments')
            .select(`
        *,
        patients(*),
        services(*),
        appointment_allocations(
          id,
          service_phase_id,
          professional_id,
          physical_resource_id,
          starts_at,
          ends_at,
          profiles:professional_id(full_name),
          physical_resources:physical_resource_id(name, type),
          service_phases:service_phase_id(phase_order, duration_minutes, requires_resource_type, label, sub_services:services!service_phases_sub_service_id_fkey(name, color))
        )
      `)
            .order('starts_at', { ascending: true });

        if (filters.professionalId) {
            query = query.eq('appointment_allocations.professional_id', filters.professionalId);
        }
        if (filters.startDate) {
            query = query.gte('starts_at', filters.startDate);
        }
        if (filters.endDate) {
            query = query.lte('starts_at', filters.endDate);
        }

        const { data, error } = await query;
        if (error) throw new AppError(error.message, 500, 'DB_FETCH_ERROR');
        return data as Appointment[];
    }

    /**
     * Create a new appointment using the availability engine.
     */
    static async createAppointment(
        supabase: SupabaseClient,
        payload: CreateAppointmentDTO,
    ): Promise<Appointment> {
        const start = parseISO(payload.starts_at);
        if (isBefore(start, new Date())) {
            throw new AppError('No se puede agendar en el pasado', 400, 'INVALID_TIME_RANGE');
        }

        // Verify patient exists
        const { data: patient, error: patientErr } = await supabase
            .from('patients')
            .select('id')
            .eq('id', payload.patient_id)
            .is('deleted_at', null)
            .maybeSingle();

        if (patientErr || !patient) {
            throw new AppError('Paciente no encontrado', 404, 'PATIENT_NOT_FOUND');
        }

        // Check existing scheduled appointment for this patient
        const { data: existingAppt } = await supabase
            .from('appointments')
            .select('id, starts_at, services(name)')
            .eq('patient_id', payload.patient_id)
            .eq('status', 'scheduled')
            .maybeSingle();

        if (existingAppt) {
            const serviceName = (existingAppt as any).services?.name || 'desconocido';
            const dateStr = new Date(existingAppt.starts_at).toLocaleDateString('es-CL');
            throw new AppError(
                `El paciente ya tiene una cita programada (${serviceName} el ${dateStr}). Cancela o reagenda la cita existente primero.`,
                409,
                'PATIENT_ALREADY_HAS_APPOINTMENT',
            );
        }

        // Allocate resources
        const { allocations, ends_at } = await AvailabilityEngine.allocateResourcesForService(
            supabase, payload.service_id, start,
        );

        // Insert appointment
        const { data: appointment, error: apptError } = await supabase
            .from('appointments')
            .insert([{
                patient_id: payload.patient_id,
                service_id: payload.service_id,
                starts_at: start.toISOString(),
                ends_at: ends_at.toISOString(),
                status: 'scheduled',
                notes: payload.notes,
            }])
            .select()
            .single();

        if (apptError) throw new AppError(apptError.message, 500, 'DB_INSERT_ERROR');

        // Insert phase allocations
        const allocationRows = allocations.map(alloc => ({
            appointment_id: appointment.id,
            service_phase_id: alloc.service_phase_id,
            professional_id: alloc.professional_id,
            physical_resource_id: alloc.physical_resource_id,
            starts_at: alloc.starts_at,
            ends_at: alloc.ends_at,
        }));

        const { error: allocError } = await supabase
            .from('appointment_allocations')
            .insert(allocationRows);

        if (allocError) {
            await supabase.from('appointments').delete().eq('id', appointment.id);
            throw new AppError('Error al bloquear los recursos. Intenta de nuevo.', 500, 'ALLOCATION_ERROR');
        }

        return { ...appointment, allocations } as any;
    }

    /**
     * Reschedule an appointment (atomic with rollback).
     */
    static async rescheduleAppointment(
        supabase: SupabaseClient,
        id: string,
        payload: RescheduleAppointmentDTO,
    ): Promise<Appointment> {
        // Load existing
        const { data: existing, error: loadErr } = await supabase
            .from('appointments')
            .select('*')
            .eq('id', id)
            .single();

        if (loadErr || !existing) throw new AppError('Cita no encontrada', 404, 'APPOINTMENT_NOT_FOUND');
        if (existing.status === 'cancelled') throw new AppError('No se puede reagendar una cita cancelada', 409, 'APPOINTMENT_CANCELLED');
        if (existing.status === 'completed') throw new AppError('No se puede reagendar una cita completada', 409, 'APPOINTMENT_COMPLETED');

        const newServiceId = payload.service_id || existing.service_id;
        const newStartsAt = payload.starts_at || existing.starts_at;
        const newStart = parseISO(newStartsAt);

        if (isBefore(newStart, new Date())) {
            throw new AppError('No se puede reagendar al pasado', 400, 'INVALID_TIME_RANGE');
        }

        // Snapshot for rollback
        const originalData = {
            service_id: existing.service_id,
            starts_at: existing.starts_at,
            ends_at: existing.ends_at,
            status: existing.status,
        };

        const { data: oldAllocations } = await supabase
            .from('appointment_allocations')
            .select('*')
            .eq('appointment_id', id);

        // Temporarily cancel so engine doesn't see it
        await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id);

        try {
            const { allocations, ends_at } = await AvailabilityEngine.allocateResourcesForService(
                supabase, newServiceId, newStart,
            );

            await supabase.from('appointment_allocations').delete().eq('appointment_id', id);

            const newRows = allocations.map(alloc => ({
                appointment_id: id,
                service_phase_id: alloc.service_phase_id,
                professional_id: alloc.professional_id,
                physical_resource_id: alloc.physical_resource_id,
                starts_at: alloc.starts_at,
                ends_at: alloc.ends_at,
            }));

            const { error: insertErr } = await supabase
                .from('appointment_allocations')
                .insert(newRows);

            if (insertErr) throw new Error('Error insertando nuevas allocations');

            const updateFields: Record<string, unknown> = {
                service_id: newServiceId,
                starts_at: newStart.toISOString(),
                ends_at: ends_at.toISOString(),
                status: 'scheduled',
            };

            if (payload.notes !== undefined) updateFields.notes = payload.notes;

            const { data: updated, error: updateErr } = await supabase
                .from('appointments')
                .update(updateFields)
                .eq('id', id)
                .select()
                .single();

            if (updateErr) throw new Error('Error actualizando la cita');
            return { ...updated, allocations } as any;

        } catch (engineError: any) {
            // ROLLBACK
            await supabase.from('appointments').update(originalData).eq('id', id);

            if (oldAllocations?.length) {
                const { data: current } = await supabase
                    .from('appointment_allocations')
                    .select('id')
                    .eq('appointment_id', id);

                if (!current?.length) {
                    const restoreRows = oldAllocations.map(a => ({
                        appointment_id: a.appointment_id,
                        service_phase_id: a.service_phase_id,
                        professional_id: a.professional_id,
                        physical_resource_id: a.physical_resource_id,
                        starts_at: a.starts_at,
                        ends_at: a.ends_at,
                    }));
                    await supabase.from('appointment_allocations').insert(restoreRows);
                }
            }

            if (engineError instanceof AppError) throw engineError;
            throw new AppError(
                `No se pudo reagendar: ${engineError.message}. La cita original se mantuvo sin cambios.`,
                409,
                'RESCHEDULE_FAILED',
            );
        }
    }

    /**
     * Update non-scheduling fields (status, notes).
     */
    static async updateAppointment(
        supabase: SupabaseClient,
        id: string,
        payload: RescheduleAppointmentDTO & { status?: string },
    ): Promise<Appointment> {
        if (payload.starts_at || payload.service_id) {
            return this.rescheduleAppointment(supabase, id, payload);
        }

        if ((payload as any).status) {
            const { data: existing } = await supabase
                .from('appointments')
                .select('id, status, starts_at')
                .eq('id', id)
                .single();

            if (!existing) throw new AppError('Cita no encontrada', 404, 'APPOINTMENT_NOT_FOUND');

            const now = new Date();
            const start = new Date(existing.starts_at);

            if (((payload as any).status === 'completed' || (payload as any).status === 'no_show') && isBefore(now, start)) {
                throw new AppError(
                    `No se puede marcar como "${(payload as any).status === 'completed' ? 'completada' : 'no asistió'}" una cita que aún no ha comenzado`,
                    422, 'INVALID_STATUS_TRANSITION',
                );
            }

            if (existing.status === 'cancelled' && (payload as any).status !== 'cancelled') {
                throw new AppError('No se puede cambiar el estado de una cita cancelada', 409, 'APPOINTMENT_CANCELLED');
            }

            if (existing.status === 'completed' && (payload as any).status === 'scheduled') {
                throw new AppError('No se puede revertir una cita completada a agendada', 409, 'INVALID_STATUS_TRANSITION');
            }
        }

        const { data, error } = await supabase
            .from('appointments')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw new AppError(error.message, 500, 'DB_UPDATE_ERROR');
        return data as Appointment;
    }

    /**
     * Cancel (soft delete) an appointment.
     */
    static async cancelAppointment(supabase: SupabaseClient, id: string): Promise<void> {
        const { data: existing } = await supabase
            .from('appointments')
            .select('id, status')
            .eq('id', id)
            .single();

        if (!existing) throw new AppError('Cita no encontrada', 404, 'APPOINTMENT_NOT_FOUND');
        if (existing.status === 'cancelled') throw new AppError('La cita ya está cancelada', 409, 'ALREADY_CANCELLED');

        await supabase.from('appointment_allocations').delete().eq('appointment_id', id);

        const { error } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .eq('id', id);

        if (error) throw new AppError(error.message, 500, 'DB_DELETE_ERROR');
    }
}
