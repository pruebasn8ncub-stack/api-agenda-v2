import { buildApp } from './app.js';
import { getEnv } from './config/env.js';

async function main() {
    const env = getEnv();
    const app = await buildApp();

    // Graceful shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
        process.on(signal, async () => {
            app.log.info(`Received ${signal}, shutting down gracefully...`);
            await app.close();
            process.exit(0);
        });
    }

    try {
        const address = await app.listen({
            port: env.API_PORT,
            host: '0.0.0.0', // Listen on all interfaces (required for Docker)
        });
        app.log.info(`🚀 Api-Agenda v2 running at ${address}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

main();
