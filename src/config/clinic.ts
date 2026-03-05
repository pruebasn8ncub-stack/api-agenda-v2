import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from './env.js';

/**
 * Dynamic clinic configuration loaded from `clinic_settings` table.
 * Falls back to sensible defaults if the table doesn't exist yet.
 */
export interface ClinicConfig {
    slot_interval_minutes: number;
    timezone: string;
    max_lookahead_days: number;
    working_hours_start: string; // HH:MM
    working_hours_end: string;   // HH:MM
}

const DEFAULTS: ClinicConfig = {
    slot_interval_minutes: 15,
    timezone: 'America/Santiago',
    max_lookahead_days: 3,
    working_hours_start: '08:00',
    working_hours_end: '20:00',
};

let _cachedConfig: ClinicConfig | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60_000; // Refresh every 60 seconds

export async function getClinicConfig(supabase: SupabaseClient): Promise<ClinicConfig> {
    const now = Date.now();
    if (_cachedConfig && (now - _cacheTime) < CACHE_TTL_MS) {
        return _cachedConfig;
    }

    try {
        const { data, error } = await supabase
            .from('clinic_settings')
            .select('key, value');

        if (error || !data || data.length === 0) {
            _cachedConfig = { ...DEFAULTS };
            _cacheTime = now;
            return _cachedConfig;
        }

        const settings: Record<string, unknown> = {};
        for (const row of data) {
            settings[row.key] = row.value;
        }

        _cachedConfig = {
            slot_interval_minutes: (settings.slot_interval_minutes as number) ?? DEFAULTS.slot_interval_minutes,
            timezone: (settings.timezone as string) ?? DEFAULTS.timezone,
            max_lookahead_days: (settings.max_lookahead_days as number) ?? DEFAULTS.max_lookahead_days,
            working_hours_start: (settings.working_hours_start as string) ?? DEFAULTS.working_hours_start,
            working_hours_end: (settings.working_hours_end as string) ?? DEFAULTS.working_hours_end,
        };
        _cacheTime = now;
        return _cachedConfig;
    } catch {
        _cachedConfig = { ...DEFAULTS };
        _cacheTime = now;
        return _cachedConfig;
    }
}

/** Reset cache (for testing) */
export function resetClinicConfigCache(): void {
    _cachedConfig = null;
    _cacheTime = 0;
}
