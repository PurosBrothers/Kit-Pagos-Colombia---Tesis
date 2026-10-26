"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./config");
const payments_1 = require("./payments");
async function main() {
    const config = (0, config_1.loadCheckoutConfig)();
    const app = (0, app_1.buildApp)({ payments: (0, payments_1.createPayments)(), publicBaseUrl: config.publicBaseUrl });
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`Checkout en ${config.publicBaseUrl}. Webhooks en ${config.publicBaseUrl}/webhooks`);
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
