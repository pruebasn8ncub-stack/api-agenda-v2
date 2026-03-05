import type { SupabaseClient } from '@supabase/supabase-js';
import { addMinutes } from 'date-fns';
import { AppError } from '../lib/errors.js';
import { getTimeParts, createZonedDate, formatTimeInZone, getLocalHour } from '../lib/timezone.js';
import { getClinicConfig } from '../config/clinic.js';
import type {
    PhaseDefinition,
    PhaseAllocation,
    AllocationResult,
    SmartAvailabilityResponse,
} from '../types/index.js';

// ── Pre-fetched data for in-memory evaluation ──────────────────────────

interface DayData {
    globalBlocks: { starts_at: string; ends_at: string }[];
    resources: { id: string; name: string; type: string }[];
    allocations: {
        physical_resource_id: string | null;
        professional_id: string;
        starts_at: string;
        ends_at: string;
        fraction: number;
    }[];
    resourceExceptions: { physical_resource_id: string; starts_at: string; ends_at: string }[];
    professionalExceptions: { professional_id: string; starts_at: string; ends_at: string }[];
    professionals: { id: string; full_name: string }[];
    schedules: { professional_id: string; start_time: string; end_time: string }[];
}

// ── Helper: check time overlap ─────────────────────────────────────────

function overlaps(s1: string, e1: string, s2: string, e2: string): boolean {
    return new Date(s1).getTime() < new Date(e2).getTime() &&
        new Date(s2).getTime() < new Date(e1).getTime();
}

function overlapsMs(s1: number, e1: number, s2: number, e2: number): boolean {
    return s1 < e2 && s2 < e1;
}

// ══════════════════════════════════════════════════════════════════════
//  AVAILABILITY ENGINE v3 — Batch Loading + In-Memory Evaluation
// ══════════════════════════════════════════════════════════════════════

export class AvailabilityEngine {
    /**
     * Pre-fetch ALL data for a date range in a single parallel batch.
     * This eliminates N+1 queries — everything runs in memory after this.
     */
    static async loadDayData(
        supabase: SupabaseClient,
        dateStr: string,
        timezone: string,
    ): Promise<DayData> {
        const dayStart = createZonedDate(dateStr, '00:00', timezone);
        const dayEnd = createZonedDate(dateStr, '23:59', timezone);
        const dayStartIso = dayStart.toISOString();
        const dayEndIso = dayEnd.toISOString();

        const searchDateObj = createZonedDate(dateStr, '12:00', timezone);
        const targetDayIndex = getTimeParts(searchDateObj, timezone).dayIndex;

        const [
            { data: rawGlobalBlocks },
            { data: allResources },
            { data: rawAllocations },
            { data: rawExceptions },
            { data: allProfessionals },
            { data: allSchedules },
        ] = await Promise.all([
            supabase
                .from('schedule_exceptions')
                .select('id, starts_at, ends_at')
                .is('professional_id', null)
                .is('physical_resource_id', null)
                .lt('starts_at', dayEndIso)
                .gt('ends_at', dayStartIso),
            supabase
                .from('physical_resources')
                .select('id, name, type')
                .eq('is_active', true),
            supabase
                .from('appointment_allocations')
                .select('physical_resource_id, professional_id, starts_at, ends_at, service_phase_id, appointments!inner(status, services(required_professionals)), service_phases(requires_professional_fraction)')
                .lt('starts_at', dayEndIso)
                .gt('ends_at', dayStartIso)
                .neq('appointments.status', 'cancelled'),
            supabase
                .from('schedule_exceptions')
                .select('id, professional_id, physical_resource_id, starts_at, ends_at')
                .lt('starts_at', dayEndIso)
                .gt('ends_at', dayStartIso),
            supabase
                .from('profiles')
                .select('id, full_name')
                .eq('role', 'professional'),
            supabase
                .from('professional_schedules')
                .select('professional_id, start_time, end_time')
                .eq('day_of_week', targetDayIndex),
        ]);

        // Normalize allocations to include fraction
        const allocations = (rawAllocations ?? []).map((a: any) => ({
            physical_resource_id: a.physical_resource_id,
            professional_id: a.professional_id,
            starts_at: a.starts_at,
            ends_at: a.ends_at,
            fraction: parseFloat(
                (a.service_phases?.requires_professional_fraction
                    ?? a.appointments?.services?.required_professionals
                    ?? 1).toString()
            ),
        }));

        // Separate exceptions by type
        const exceptions = rawExceptions ?? [];
        const resourceExceptions = exceptions
            .filter((e: any) => e.physical_resource_id != null)
            .map((e: any) => ({
                physical_resource_id: e.physical_resource_id!,
                starts_at: e.starts_at,
                ends_at: e.ends_at,
            }));
        const professionalExceptions = exceptions
            .filter((e: any) => e.professional_id != null)
            .map((e: any) => ({
                professional_id: e.professional_id!,
                starts_at: e.starts_at,
                ends_at: e.ends_at,
            }));

        return {
            globalBlocks: rawGlobalBlocks ?? [],
            resources: allResources ?? [],
            allocations,
            resourceExceptions,
            professionalExceptions,
            professionals: allProfessionals ?? [],
            schedules: allSchedules ?? [],
        };
    }

    /**
     * Load the phases for a service (composite or simple).
     */
    static async loadPhases(
        supabase: SupabaseClient,
        serviceId: string,
    ): Promise<{ service: any; phases: PhaseDefinition[] }> {
        const { data: service, error: sErr } = await supabase
            .from('services')
            .select('id, name, duration_minutes, required_resource_type, required_professionals, is_active, is_composite')
            .eq('id', serviceId)
            .single();

        if (sErr || !service) throw new AppError('Servicio no encontrado', 404, 'SERVICE_NOT_FOUND');
        if (!service.is_active) throw new AppError('Este servicio no está disponible actualmente', 409, 'SERVICE_INACTIVE');

        let phases: PhaseDefinition[];

        // Always check service_phases first (works for both composite and simple with explicit phases)
        const { data: dbPhases } = await supabase
            .from('service_phases')
            .select('id, phase_order, duration_minutes, requires_professional_fraction, requires_resource_type')
            .eq('service_id', serviceId)
            .order('phase_order', { ascending: true });

        if (dbPhases && dbPhases.length > 0) {
            phases = dbPhases.map(p => ({
                ...p,
                requires_professional_fraction: parseFloat(p.requires_professional_fraction.toString()),
            }));
        } else if (!service.is_composite) {
            // Virtual single phase from service-level fields
            phases = [{
                id: '__virtual__',
                phase_order: 1,
                duration_minutes: service.duration_minutes,
                requires_professional_fraction: parseFloat(service.required_professionals.toString()),
                requires_resource_type: service.required_resource_type,
            }];
        } else {
            throw new AppError('El servicio compuesto no tiene fases configuradas', 500, 'NO_PHASES');
        }

        return { service, phases };
    }

    /**
     * Evaluate a single time slot purely in-memory.
     * Returns trial allocations if the slot is valid, or null if not.
     */
    static evaluateSlot(
        slotStart: Date,
        phases: PhaseDefinition[],
        dayData: DayData,
        timezone: string,
    ): PhaseAllocation[] | null {
        const trialAllocations: {
            service_phase_id: string | null;
            professional_id: string;
            physical_resource_id: string | null;
            starts_at: string;
            ends_at: string;
            fraction: number;
        }[] = [];

        let currentPhaseStart = new Date(slotStart.getTime());

        for (const phase of phases) {
            const currentPhaseEnd = addMinutes(currentPhaseStart, phase.duration_minutes);
            const phaseStartIso = currentPhaseStart.toISOString();
            const phaseEndIso = currentPhaseEnd.toISOString();
            const reqFraction = phase.requires_professional_fraction;

            // 1. Clinic blocked?
            if (dayData.globalBlocks.some(b => overlaps(b.starts_at, b.ends_at, phaseStartIso, phaseEndIso))) {
                return null;
            }

            // 2. Resource Available?
            let allocatedResId: string | null = null;
            if (phase.requires_resource_type) {
                const typeResources = dayData.resources.filter(r => r.type === phase.requires_resource_type);
                const freeResource = typeResources.find(r => {
                    // Not blocked by exception
                    if (dayData.resourceExceptions.some(e =>
                        e.physical_resource_id === r.id && overlaps(e.starts_at, e.ends_at, phaseStartIso, phaseEndIso)
                    )) return false;
                    // Not booked by existing appointment
                    if (dayData.allocations.some(a =>
                        a.physical_resource_id === r.id && overlaps(a.starts_at, a.ends_at, phaseStartIso, phaseEndIso)
                    )) return false;
                    // Not used in earlier trial phases
                    if (trialAllocations.some(ta =>
                        ta.physical_resource_id === r.id && overlaps(ta.starts_at, ta.ends_at, phaseStartIso, phaseEndIso)
                    )) return false;
                    return true;
                });

                if (!freeResource) return null;
                allocatedResId = freeResource.id;
            }

            // 3. Professional Available?
            let allocatedProfId: string | null = null;
            if (reqFraction > 0) {
                const sParts = getTimeParts(currentPhaseStart, timezone);
                const eParts = getTimeParts(currentPhaseEnd, timezone);

                const freeProf = dayData.professionals.find(p => {
                    // Has schedule for this day?
                    const sched = dayData.schedules.find(s => s.professional_id === p.id);
                    if (!sched) return false;

                    // Within working hours?
                    if (sParts.time < sched.start_time || eParts.time > sched.end_time) return false;

                    // Not on exception?
                    if (dayData.professionalExceptions.some(e =>
                        e.professional_id === p.id && overlaps(e.starts_at, e.ends_at, phaseStartIso, phaseEndIso)
                    )) return false;

                    // Capacity check using interval-based approach instead of minute-by-minute
                    const phaseStartMs = currentPhaseStart.getTime();
                    const phaseEndMs = currentPhaseEnd.getTime();

                    // Collect all load intervals for this professional that overlap with this phase
                    const existingLoad = dayData.allocations
                        .filter(a => a.professional_id === p.id && overlapsMs(
                            new Date(a.starts_at).getTime(), new Date(a.ends_at).getTime(),
                            phaseStartMs, phaseEndMs,
                        ));

                    const trialLoad = trialAllocations
                        .filter(a => a.professional_id === p.id && overlapsMs(
                            new Date(a.starts_at).getTime(), new Date(a.ends_at).getTime(),
                            phaseStartMs, phaseEndMs,
                        ));

                    // Check capacity at critical boundaries (not every minute)
                    const criticalPoints = new Set<number>();
                    criticalPoints.add(phaseStartMs);
                    for (const a of [...existingLoad, ...trialLoad]) {
                        const aStart = new Date(a.starts_at).getTime();
                        const aEnd = new Date(a.ends_at).getTime();
                        if (aStart > phaseStartMs && aStart < phaseEndMs) criticalPoints.add(aStart);
                        if (aEnd > phaseStartMs && aEnd < phaseEndMs) criticalPoints.add(aEnd);
                    }

                    for (const t of criticalPoints) {
                        let load = 0;
                        for (const a of existingLoad) {
                            const aStart = new Date(a.starts_at).getTime();
                            const aEnd = new Date(a.ends_at).getTime();
                            if (t >= aStart && t < aEnd) load += a.fraction;
                        }
                        for (const a of trialLoad) {
                            const aStart = new Date(a.starts_at).getTime();
                            const aEnd = new Date(a.ends_at).getTime();
                            if (t >= aStart && t < aEnd) load += a.fraction;
                        }
                        if (load + reqFraction > 1.0) return false;
                    }

                    return true;
                });

                if (!freeProf) return null;
                allocatedProfId = freeProf.id;
            } else {
                // Phase doesn't require professional — reuse last or first available
                allocatedProfId = trialAllocations.length > 0
                    ? trialAllocations[trialAllocations.length - 1].professional_id
                    : (dayData.professionals[0]?.id ?? '');
            }

            trialAllocations.push({
                service_phase_id: phase.id === '__virtual__' ? null : phase.id,
                professional_id: allocatedProfId,
                physical_resource_id: allocatedResId,
                starts_at: phaseStartIso,
                ends_at: phaseEndIso,
                fraction: reqFraction,
            });

            currentPhaseStart = currentPhaseEnd;
        }

        // Return allocations without the internal `fraction` field
        return trialAllocations.map(({ fraction, ...rest }) => rest);
    }

    /**
     * Get available time slots for a service on a given date.
     * All DB data is loaded once, then slots are evaluated in-memory.
     */
    static async getAvailableSlots(
        supabase: SupabaseClient,
        serviceId: string,
        date: string,
    ): Promise<string[]> {
        const config = await getClinicConfig(supabase);
        const { service, phases } = await this.loadPhases(supabase, serviceId);
        if (!service.is_active) return [];

        const dayData = await this.loadDayData(supabase, date, config.timezone);
        const interval = config.slot_interval_minutes;

        // Parse working hours
        const [startH, startM] = config.working_hours_start.split(':').map(Number);
        const [endH, endM] = config.working_hours_end.split(':').map(Number);

        const slots: string[] = [];

        for (let h = startH; h <= endH; h++) {
            for (let m = (h === startH ? startM : 0); m < 60; m += interval) {
                if (h === endH && m >= endM) break;

                const slotStart = createZonedDate(
                    date,
                    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
                    config.timezone,
                );

                const result = this.evaluateSlot(slotStart, phases, dayData, config.timezone);
                if (result) {
                    // Check end time is within reasonable hours
                    const totalDuration = phases.reduce((sum, p) => sum + p.duration_minutes, 0);
                    const slotEnd = addMinutes(slotStart, totalDuration);
                    const endHour = getLocalHour(slotEnd, config.timezone);
                    if (endHour <= 21) {
                        slots.push(slotStart.toISOString());
                    }
                }
            }
        }

        return slots;
    }

    /**
     * Allocate resources for ALL phases of a service (used during booking).
     * Uses the same in-memory evaluation but requests specific start time.
     */
    static async allocateResourcesForService(
        supabase: SupabaseClient,
        serviceId: string,
        requestedStartTime: Date,
    ): Promise<AllocationResult> {
        const config = await getClinicConfig(supabase);

        // Get the date string from the requested start
        const dateStr = requestedStartTime.toISOString().split('T')[0];
        const { phases } = await this.loadPhases(supabase, serviceId);
        const dayData = await this.loadDayData(supabase, dateStr!, config.timezone);

        const result = this.evaluateSlot(requestedStartTime, phases, dayData, config.timezone);
        if (!result) {
            throw new AppError(
                'No hay disponibilidad para el horario solicitado. Todos los recursos o profesionales están ocupados.',
                409,
                'NO_AVAILABILITY',
            );
        }

        const totalDuration = phases.reduce((sum, p) => sum + p.duration_minutes, 0);

        return {
            allocations: result,
            ends_at: addMinutes(requestedStartTime, totalDuration),
        };
    }

    /**
     * AI-friendly availability with proactive lookahead and natural language hints.
     */
    static async getSmartAvailability(
        supabase: SupabaseClient,
        serviceId: string,
        requestedDate: string,
    ): Promise<SmartAvailabilityResponse> {
        const config = await getClinicConfig(supabase);
        const maxLookahead = config.max_lookahead_days;

        let currentDateStr = requestedDate;
        let foundSlots: string[] = [];
        let lookaheadCount = 0;

        // Proactive search
        while (lookaheadCount < maxLookahead) {
            foundSlots = await this.getAvailableSlots(supabase, serviceId, currentDateStr);
            if (foundSlots.length >= 3) break;

            const nextDate = new Date(`${currentDateStr}T12:00:00Z`);
            nextDate.setUTCDate(nextDate.getUTCDate() + 1);
            currentDateStr = nextDate.toISOString().split('T')[0]!;
            lookaheadCount++;
        }

        // Continuous blocks
        const continuousBlocks: { start_time: string; end_time: string }[] = [];
        if (foundSlots.length > 0) {
            let blockStart = new Date(foundSlots[0]!);
            let lastSlot = new Date(foundSlots[0]!);

            for (let i = 1; i < foundSlots.length; i++) {
                const slotTime = new Date(foundSlots[i]!);
                const expected = addMinutes(new Date(foundSlots[i - 1]!), config.slot_interval_minutes);

                if (slotTime.getTime() === expected.getTime()) {
                    lastSlot = slotTime;
                } else {
                    continuousBlocks.push({
                        start_time: formatTimeInZone(blockStart, config.timezone),
                        end_time: formatTimeInZone(lastSlot, config.timezone),
                    });
                    blockStart = slotTime;
                    lastSlot = slotTime;
                }
            }
            continuousBlocks.push({
                start_time: formatTimeInZone(blockStart, config.timezone),
                end_time: formatTimeInZone(lastSlot, config.timezone),
            });
        }

        // Group by time of day
        const slots = { morning: [] as string[], afternoon: [] as string[], evening: [] as string[] };
        for (const slotIso of foundSlots) {
            const hour = getLocalHour(new Date(slotIso), config.timezone);
            if (hour < 12) slots.morning.push(slotIso);
            else if (hour < 18) slots.afternoon.push(slotIso);
            else slots.evening.push(slotIso);
        }

        // AI hint (natural language)
        let ai_hint: string;
        if (continuousBlocks.length === 0) {
            ai_hint = `No encontré ninguna disponibilidad para el ${requestedDate} ni para los ${maxLookahead - 1} días siguientes.`;
        } else {
            const dayWarning = requestedDate !== currentDateStr
                ? `No tengo cupos para el ${requestedDate}. Sin embargo, busqué para el ${currentDateStr} y `
                : `Para el ${currentDateStr} `;

            const blockPhrases = continuousBlocks.map(b => `de ${b.start_time} a ${b.end_time}`);
            let blocksStr: string;

            if (blockPhrases.length === 1) {
                blocksStr = `tengo disponibilidad continua ${blockPhrases[0]}`;
            } else if (blockPhrases.length === 2) {
                blocksStr = `tengo disponibilidad ${blockPhrases[0]} y ${blockPhrases[1]}`;
            } else {
                const last = blockPhrases.pop();
                blocksStr = `tengo disponibilidad ${blockPhrases.join(', ')} y ${last}`;
            }

            ai_hint = `${dayWarning}${blocksStr}.`;
        }

        return {
            requested_date: requestedDate,
            actual_date_searched: currentDateStr,
            slots,
            continuous_blocks: continuousBlocks,
            ai_hint,
            raw_slots: foundSlots,
        };
    }
}
