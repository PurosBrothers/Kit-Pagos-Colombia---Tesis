import { readFileSync } from "node:fs";
import path from "node:path";
import { FastifyInstance } from "fastify";

/** La raíz del prototipo, tanto desde `src/` con ts-node como desde `dist/` compilado. */
const PROTOTYPE_ROOT = path.resolve(__dirname, "..", "..");

const JAVASCRIPT = "text/javascript; charset=utf-8";

function readAsset(relativePath: string): string {
  return readFileSync(path.join(PROTOTYPE_ROOT, relativePath), "utf8");
}

/**
 * Los scripts que carga el navegador:
 * - `/assets/checkout.js`: el de las páginas, del esqueleto;
 * - `/payments/client.js`: la parte del módulo de pagos que corre en el navegador;
 * - `/vendor/kit-pagos-colombia/browser.js`: el módulo de navegador del SDK. Se sirve en los
 *   dos prototipos para que el esqueleto sea idéntico; solo el módulo de pagos de B lo usa.
 */
export async function assetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/assets/checkout.js", async (_request, reply) => {
    return reply.type(JAVASCRIPT).send(readAsset("src/public/checkout.js"));
  });

  app.get("/payments/client.js", async (_request, reply) => {
    return reply.type(JAVASCRIPT).send(readAsset("src/payments/browser/client.js"));
  });

  app.get("/vendor/kit-pagos-colombia/browser.js", async (_request, reply) => {
    const bundle = readFileSync(require.resolve("kit-pagos-colombia/browser"), "utf8");
    return reply.type(JAVASCRIPT).send(bundle);
  });
}
