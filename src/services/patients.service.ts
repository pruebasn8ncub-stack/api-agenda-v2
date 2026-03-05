import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors.js';
import type { Patient } from '../types/index.js';

export class PatientsService {

    static async getPatients(
        supabase: SupabaseClient,
        search?: string,
    ): Promise<Patient[]> {
        let query = supabase
            .from('patients')
            .select('*')
            .is('deleted_at', null)
            .order('full_name', { ascending: true });

        if (search) {
            query = query.ilike('full_name', `%${search}%`);
        }

        const { data, error } = await query;
        if (error) throw new AppError(error.message, 500, 'DB_FETCH_ERROR');
        return data as Patient[];
    }

    static async getPatientById(
        supabase: SupabaseClient,
        id: string,
    ): Promise<Patient> {
        const { data, error } = await supabase
            .from('patients')
            .select('*')
            .eq('id', id)
            .is('deleted_at', null)
            .single();

        if (error || !data) throw new AppError('Paciente no encontrado', 404, 'PATIENT_NOT_FOUND');
        return data as Patient;
    }

    static async createPatient(
        supabase: SupabaseClient,
        payload: { full_name: string; phone: string; email?: string; notes?: string },
    ): Promise<Patient> {
        const { data, error } = await supabase
            .from('patients')
            .insert([payload])
            .select()
            .single();

        if (error) throw new AppError(error.message, 500, 'DB_INSERT_ERROR');
        return data as Patient;
    }

    static async updatePatient(
        supabase: SupabaseClient,
        id: string,
        payload: Partial<{ full_name: string; phone: string; email: string; notes: string }>,
    ): Promise<Patient> {
        const { data, error } = await supabase
            .from('patients')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', id)
            .is('deleted_at', null)
            .select()
            .single();

        if (error) throw new AppError(error.message, 500, 'DB_UPDATE_ERROR');
        return data as Patient;
    }
}
