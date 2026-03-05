import fp from 'fastify-plugin';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';

declare module 'fastify' {
    interface FastifyInstance {
        supabase: SupabaseClient;
    }
}

export default fp(async (fastify) => {
    const env = getEnv();
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    fastify.decorate('supabase', supabase);
}, { name: 'supabase' });
