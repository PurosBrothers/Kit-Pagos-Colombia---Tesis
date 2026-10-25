import { buildApp } from "./app";
import { AppConfig, resolveConfig } from "./config";

function loadConfig(): AppConfig {
  try {
    return resolveConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const config = loadConfig();
const app = buildApp({ config });

app.listen({ port: config.port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Prototipo D (Austral Mate) en ${config.publicBaseUrl}, escuchando en ${address}.`);
  console.log(`Webhooks en ${config.publicBaseUrl}/webhooks/<pasarela>: wompi, mercadopago, kushki y rapyd.`);
  console.log(
    config.environment === "simulator"
      ? `Cobra en la API de Simulación (${config.simulatorBaseUrl}).`
      : "Cobra en el sandbox oficial de cada pasarela, con las llaves del .env de la raíz.",
  );
  console.log("Ábrela en localtest.me y no en localhost: Mercado Pago no deja volver de un PSE a localhost.");
});
