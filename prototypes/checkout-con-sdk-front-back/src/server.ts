import { buildApp } from "./app";
import { loadCheckoutConfig } from "./config";
import { createPayments } from "./payments";

async function main(): Promise<void> {
  const config = loadCheckoutConfig();
  const app = buildApp({ payments: createPayments(), publicBaseUrl: config.publicBaseUrl });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Checkout en ${config.publicBaseUrl}. Webhooks en ${config.publicBaseUrl}/webhooks`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
