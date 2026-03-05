import { z } from 'zod';

const envSchema = z.object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
    API_PORT: z.coerce.number().default(3000),
    API_KEY: z.string().min(8),
    CORS_ORIGINS: z.string().default('*'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
    if (!_env) {
        const result = envSchema.safeParse(process.env);
        if (!result.success) {
            console.error('❌ Invalid environment variables:');
            console.error(result.error.flatten().fieldErrors);
            process.exit(1);
        }
        _env = result.data;
    }
    return _env;
}
