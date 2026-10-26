"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetRoutes = assetRoutes;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
/** La raíz del prototipo, tanto desde `src/` con ts-node como desde `dist/` compilado. */
const PROTOTYPE_ROOT = node_path_1.default.resolve(__dirname, "..", "..");
const JAVASCRIPT = "text/javascript; charset=utf-8";
function readAsset(relativePath) {
    return (0, node_fs_1.readFileSync)(node_path_1.default.join(PROTOTYPE_ROOT, relativePath), "utf8");
}
/**
 * Los scripts que carga el navegador:
 * - `/assets/checkout.js`: el de las páginas, del esqueleto;
 * - `/payments/client.js`: la parte del módulo de pagos que corre en el navegador;
 * - `/vendor/kit-pagos-colombia/browser.js`: el módulo de navegador del SDK. Se sirve en los
 *   dos prototipos para que el esqueleto sea idéntico; solo el módulo de pagos de B lo usa.
 */
async function assetRoutes(app) {
    app.get("/assets/checkout.js", async (_request, reply) => {
        return reply.type(JAVASCRIPT).send(readAsset("src/public/checkout.js"));
    });
    app.get("/payments/client.js", async (_request, reply) => {
        return reply.type(JAVASCRIPT).send(readAsset("src/payments/browser/client.js"));
    });
    app.get("/vendor/kit-pagos-colombia/browser.js", async (_request, reply) => {
        const bundle = (0, node_fs_1.readFileSync)(require.resolve("kit-pagos-colombia/browser"), "utf8");
        return reply.type(JAVASCRIPT).send(bundle);
    });
}
