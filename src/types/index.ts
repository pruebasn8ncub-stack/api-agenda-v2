// ── Data Models (map to Supabase tables) ──────────────────────────────

export interface Profile {
    id: string;
    full_name: string;
    role: 'admin' | 'professional' | 'receptionist';
    created_at: string;
}

export interface Patient {
    id: string;
    full_name: string;
    email?: string;
    phone: string;
    notes?: string;
    created_at: string;
    updated_at: string;
    deleted_at?: string;
}

export interface PhysicalResource {
    id: string;
    name: string;
    type: string; // 'chamber' | 'box' | any future type
    is_active: boolean;
    created_at: string;
}

export interface Service {
    id: string;
    name: string;
    description: string | null;
    color: string;
    is_active: boolean;
    is_composite: boolean;
    duration_minutes: number;
    required_professionals: number;
    required_resource_type: string | null;
    created_at: string;
}

export interface ServicePhase {
    id: string;
    service_id: string;
    phase_order: number;
    duration_minutes: number;
    requires_professional_fraction: number;
    requires_resource_type: string | null;
    sub_service_id: string | null;
    label: string | null;
    created_at: string;
}

export interface Appointment {
    id: string;
    patient_id: string;
    service_id: string;
    starts_at: string;
    ends_at: string;
    status: AppointmentStatus;
    notes?: string;
    created_at: string;
    updated_at: string;
}

export type AppointmentStatus = 'scheduled' | 'cancelled' | 'completed' | 'no_show';

export interface AppointmentAllocation {
    id: string;
    appointment_id: string;
    service_phase_id: string | null;
    professional_id: string;
    physical_resource_id: string | null;
    starts_at: string;
    ends_at: string;
    created_at: string;
}

export interface ProfessionalSchedule {
    id: string;
    professional_id: string;
    day_of_week: number; // 0=Sun, 1=Mon, ..., 6=Sat
    start_time: string;  // HH:MM:SS
    end_time: string;    // HH:MM:SS
}

export interface ScheduleException {
    id: string;
    professional_id: string | null;
    physical_resource_id: string | null;
    starts_at: string;
    ends_at: string;
    reason?: string;
}

// ── DTOs ──────────────────────────────────────────────────────────────

export interface CreateAppointmentDTO {
    patient_id: string;
    service_id: string;
    starts_at: string;
    notes?: string;
}

export interface RescheduleAppointmentDTO {
    starts_at?: string;
    service_id?: string;
    notes?: string;
}

// ── Engine types ──────────────────────────────────────────────────────

export interface PhaseDefinition {
    id: string;
    phase_order: number;
    duration_minutes: number;
    requires_professional_fraction: number;
    requires_resource_type: string | null;
}

export interface PhaseAllocation {
    service_phase_id: string | null;
    professional_id: string;
    physical_resource_id: string | null;
    starts_at: string;
    ends_at: string;
}

export interface AllocationResult {
    allocations: PhaseAllocation[];
    ends_at: Date;
}

// ── API Response ──────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}

export interface SlotGroup {
    morning: string[];
    afternoon: string[];
    evening: string[];
}

export interface SmartAvailabilityResponse {
    requested_date: string;
    actual_date_searched: string;
    slots: SlotGroup;
    continuous_blocks: { start_time: string; end_time: string }[];
    ai_hint: string;
    raw_slots: string[];
}
