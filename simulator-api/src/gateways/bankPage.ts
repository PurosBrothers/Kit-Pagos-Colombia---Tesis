import { FastifyReply } from "fastify";

/**
 * La página a la que el simulador manda al pagador en un PSE (issue #109).
 *
 * Nivel 3 — convención del simulador, igual para las cuatro pasarelas. Existe porque antes
 * tres de ellas publicaban una URL del dominio real de la pasarela con un identificador
 * inventado, y abrirla daba «Esta página no existe» (Mercado Pago), un error de DNS (Kushki)
 * o una página que no reconocía el pago (Rapyd). Las rutas conservan la forma de la pasarela, y
 * tres están medidas: la de Rapyd (`docs/testing-data/rapyd.md`, sección 5.7), y la de Mercado
 * Pago y la de Kushki el 14 de octubre de 2026 (puntos 93 y 94). El contenido de la página del
 * banco no se imita.
 *
 * No decide el resultado: en las cuatro, el desenlace del PSE lo fija el banco de prueba o el
 * escenario al crear el cobro y se ve al consultarlo. La página solo devuelve al pagador a la
 * URL que el comercio pidió, que es lo que hace el banco real al terminar.
 */
const GATEWAY_NAMES = {
  wompi: "Wompi",
  mercadopago: "Mercado Pago",
  kushki: "Kushki",
  rapyd: "Rapyd",
} as const;

export type BankPageGateway = keyof typeof GATEWAY_NAMES;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Solo `http` y `https` llegan al enlace: la URL la mandó el comercio, y un `javascript:` en un
 * `href` ejecutaría código en el origen del simulador cuando alguien lo pulse.
 */
function safeReturnUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** El enlace «Volver al comercio» de una página del simulador, o el aviso de que no hay a dónde volver. */
export function renderReturnLink(returnUrl: string | undefined): string {
  const target = safeReturnUrl(returnUrl);
  return target === undefined
    ? "<p>El comercio no indicó a dónde devolver al pagador.</p>"
    : `<p><a href="${escapeHtml(target)}">Volver al comercio</a></p>`;
}

/** El HTML de la página. La lee una persona, así que va en español. */
export function renderBankPage(gateway: BankPageGateway, returnUrl: string | undefined): string {
  const back = renderReturnLink(returnUrl);

  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    "<title>Redirección simulada al banco (PSE)</title></head><body>" +
    "<h1>Redirección simulada al banco</h1>" +
    "<p>Esta página es de la API de Simulación de Kit Pagos Colombia. No es de " +
    `${GATEWAY_NAMES[gateway]} ni de un banco, y no imita la página real del banco.</p>` +
    "<p>El resultado del pago quedó decidido al crearlo. Al volver al comercio, " +
    "consulte el pago para conocerlo.</p>" +
    `${back}</body></html>`
  );
}

/** Responde la página de banco de la pasarela. */
export function sendBankPage(
  reply: FastifyReply,
  gateway: BankPageGateway,
  returnUrl: string | undefined,
): FastifyReply {
  return reply
    .code(200)
    .header("content-type", "text/html; charset=utf-8")
    .send(renderBankPage(gateway, returnUrl));
}
