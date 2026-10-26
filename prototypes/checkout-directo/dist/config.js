"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCheckoutConfig = loadCheckoutConfig;
const DEFAULT_PORT = 4000;
/** Lee `PORT` y `PUBLIC_BASE_URL` del entorno. La configuración de la pasarela es del módulo de pagos. */
function loadCheckoutConfig(env = process.env) {
    const parsedPort = Number(env.PORT);
    const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
    const publicBaseUrl = (env.PUBLIC_BASE_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, "");
    return { port, publicBaseUrl };
}
