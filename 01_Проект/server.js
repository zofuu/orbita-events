// Точка входа: node server.js
import { startServer } from './src/server.js';
import { config } from './src/config.js';

const { server } = await startServer();
console.log(`ОРБИТА запущена: http://localhost:${config.port}  (БД: ${config.dbPath})`);
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
