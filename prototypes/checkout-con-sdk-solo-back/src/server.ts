import { buildApp } from "./app";
import { resolveConfig } from "./config";

const config = resolveConfig();
const app = buildApp({ config });

app.listen({ port: config.port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`🍵 Tienda de Hierbas de Mate (SDK solo en Backend) escuchando en ${address}`);
  console.log(`   Ambiente de pagos: ${config.environment.toUpperCase()}`);
  console.log(`   Simulador base URL: ${config.simulatorBaseUrl}`);
  console.log(`   URL pública: ${config.publicBaseUrl}`);
});
