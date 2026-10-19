import { buildApp } from "./app";
import { fastifyLoggerConfig } from "./logger/redactSerializer";
import { listenAddress } from "./serverAddress";

const address = listenAddress();

const app = buildApp({ logger: fastifyLoggerConfig });

app.listen(address).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
