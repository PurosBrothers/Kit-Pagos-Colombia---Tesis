import { CreatePaymentRequest, GatewayOption, PaymentsPort } from "../checkout/PaymentsPort";
import { paymentsEnvironment } from "../checkout/environment";
import { GatewayModule, GatewayPayments } from "./gateway";
import { kushkiModule } from "./kushki";
import { mercadoPagoModule } from "./mercadopago";
import { rapydModule } from "./rapyd";
import { wompiModule } from "./wompi";

/**
 * Las pasarelas del prototipo D, en el orden en que se ofrecen al comprador. Cada una es un
 * archivo que integra su API nativa a mano, con `fetch` y siguiendo su documentación oficial
 * (punto 117 del `architecture-log.md`).
 */
const GATEWAY_MODULES: readonly GatewayModule[] = [wompiModule, mercadoPagoModule, kushkiModule, rapydModule];

/**
 * El módulo de pagos del prototipo D: reúne las pasarelas en el `PaymentsPort` del esqueleto.
 *
 * En el sandbox oficial, una pasarela queda activa solo si están sus llaves en el `.env` de la
 * raíz, o la variable que la apunta a otra URL. Si no queda ninguna, el checkout no arranca y
 * dice qué falta. En el simulador todas tienen valores por omisión.
 */
export function createPayments(env: NodeJS.ProcessEnv = process.env): PaymentsPort {
  const { environment } = paymentsEnvironment(env);
  const missing: string[] = [];
  const active = new Map<string, { option: GatewayOption; payments: GatewayPayments }>();
  for (const module of GATEWAY_MODULES) {
    const absent = module.sandboxKeys.filter((name) => !env[name]?.trim());
    if (environment === "sandbox" && !env[module.baseUrlVariable]?.trim() && absent.length > 0) {
      missing.push(`${module.option.name}: ${absent.join(", ")}`);
      continue;
    }
    active.set(module.option.id, { option: module.option, payments: module.create(env) });
  }
  if (active.size === 0) {
    throw new Error(
      `Para cobrar en el sandbox faltan las llaves de todas las pasarelas en el .env de la raíz (${missing.join("; ")}). ` +
        "Sin ellas, usa el simulador: npm run start:local.",
    );
  }

  function gateway(id: string): GatewayPayments {
    const found = active.get(id);
    if (!found) throw new Error(`El checkout no cobra con la pasarela «${id}»`);
    return found.payments;
  }

  return {
    listGateways: () => [...active.values()].map(({ option }) => option),
    publicConfig: (id) => ({ gateway: id, ...gateway(id).publicConfig() }),
    listPseBanks: (id) => gateway(id).listPseBanks(),
    createPayment: (request: CreatePaymentRequest) => gateway(request.gateway).createPayment(request),
    getPaymentStatus: (id, transactionId) => gateway(id).getPaymentStatus(transactionId),
    verifyWebhook: (id, webhook) => gateway(id).verifyWebhook(webhook),
  };
}
