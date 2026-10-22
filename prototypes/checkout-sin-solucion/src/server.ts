import { buildApp } from "./app";
import { paymentsEnvironment } from "./checkout/environment";
import { applyArguments, loadCheckoutConfig, loadRootEnv, ROOT_ENV_FILE } from "./config";
import { createPayments } from "./payments";
import { enableTrace, traceIncomingRequests, traceOutgoingCalls } from "./trace";

async function main(): Promise<void> {
  applyArguments(process.argv.slice(2));
  const foundEnvFile = loadRootEnv();
  const config = loadCheckoutConfig();
  const { environment, simulatorUrl } = paymentsEnvironment();
  enableTrace();
  traceOutgoingCalls();
  const payments = createPayments();
  const app = buildApp({ payments, publicBaseUrl: config.publicBaseUrl });
  traceIncomingRequests(app);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  const gateways = payments.listGateways();
  console.log(`Checkout en ${config.publicBaseUrl}. Webhooks en ${config.publicBaseUrl}/webhooks/<pasarela>`);
  console.log(`Pasarelas: ${gateways.map((gateway) => `${gateway.name} (/webhooks/${gateway.id})`).join(", ")}.`);
  console.log(
    environment === "sandbox"
      ? "Cobra en el sandbox oficial de cada pasarela; la que no tenga sus llaves en el .env de la raíz queda fuera del selector. Para el simulador: npm run start:local (local) o npm start -- --environment=simulator (Render)."
      : `Cobra en la API de Simulación de ${simulatorUrl}.`,
  );
  if (!foundEnvFile) {
    console.log(`No encontré ${ROOT_ENV_FILE}: el módulo de pagos usa solo las variables del entorno.`);
  }
  console.log("Traza: cada petición que llega y cada llamada a una pasarela salen aquí con [checkout], sin llaves ni cuerpos.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
