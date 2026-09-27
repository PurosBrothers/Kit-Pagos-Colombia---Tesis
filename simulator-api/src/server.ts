import { buildApp } from "./app";
import { fastifyLoggerConfig } from "./logger/redactSerializer";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = buildApp({ logger: fastifyLoggerConfig });

app.listen({ port: PORT, host: HOST }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
