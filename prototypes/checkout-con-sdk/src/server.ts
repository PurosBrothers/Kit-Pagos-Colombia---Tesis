import { buildApp } from "./app";
import { paymentsEnvironment } from "./checkout/environment";
import { applyArguments, loadCheckoutConfig, loadRootEnv, ROOT_ENV_FILE } from "./config";
import { createPayments } from "./payments";

async function main(): Promise<void> {
  applyArguments(process.argv.slice(2));
  const foundEnvFile = loadRootEnv();
  const config = loadCheckoutConfig();
  const { environment, simulatorUrl } = paymentsEnvironment();
  const app = buildApp({ payments: createPayments(), publicBaseUrl: config.publicBaseUrl });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Checkout en ${config.publicBaseUrl}. Webhooks en ${config.publicBaseUrl}/webhooks`);
  console.log(
    environment === "sandbox"
      ? "Cobra en el sandbox oficial de la pasarela. Para el simulador: npm run start:local (local) o npm start -- --environment=simulator (Render)."
      : `Cobra en la API de Simulación de ${simulatorUrl}.`,
  );
  if (!foundEnvFile) {
    console.log(`No encontré ${ROOT_ENV_FILE}: el módulo de pagos usa solo las variables del entorno.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
