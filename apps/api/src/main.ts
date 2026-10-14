import { createApiApplication } from './application.js';
const app = await createApiApplication();
await app.listen(Number(process.env.PORT ?? 4000), process.env.HOST ?? '127.0.0.1');
console.log(`Campus Judge NestJS API listening on ${await app.getUrl()}`);
