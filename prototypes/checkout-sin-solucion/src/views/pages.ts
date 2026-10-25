import { Product } from "../catalog";
import { CheckoutEnvironment } from "../checkout/environment";
import { DeclineCategory, GatewayOption } from "../checkout/PaymentsPort";
import { describeDecline, Order, OrderStatus, StatusRecord, StatusSource } from "../orders/OrderStore";
import { COVER_SPRITE } from "./art";
import { STORE_CSS } from "./styles";

const STATUS_LABELS: Record<OrderStatus, string> = {
  APPROVED: "Aprobado",
  DECLINED: "Rechazado",
  PENDING: "Pendiente",
  ERROR: "Error técnico",
};

const SOURCE_LABELS: Record<StatusSource, string> = {
  creation: "Creación",
  query: "Consulta",
  webhook: "Webhook",
};

/** Lo que lee el comprador según el estado de su orden. */
const RESULTS: Record<OrderStatus, { icon: string; title: string; detail: string }> = {
  APPROVED: {
    icon: "✓",
    title: "¡Gracias! Tu pago fue aprobado",
    detail: "Ya estamos empacando tus cómics. Te escribimos cuando salgan para tu casa.",
  },
  DECLINED: {
    icon: "✕",
    title: "Tu pago fue rechazado",
    detail: "La pasarela no aprobó el pago. Puedes volver a intentarlo con otra tarjeta o con PSE.",
  },
  PENDING: {
    icon: "…",
    title: "Tu pago está en proceso",
    detail: "Estamos esperando la confirmación de la pasarela. Esta página se actualiza sola.",
  },
  ERROR: {
    icon: "!",
    title: "No pudimos procesar el pago",
    detail: "Un fallo técnico no dejó completar el pago, y no quedó decidido. Vuelve a intentarlo en unos minutos.",
  },
};

/**
 * Lo que lee el comprador de un rechazo cuyo motivo se conoce. Un rechazo sin motivo, o con
 * `UNKNOWN`, se queda con el texto general de `RESULTS.DECLINED`.
 */
const DECLINE_DETAILS: Record<Exclude<DeclineCategory, "UNKNOWN">, string> = {
  INSUFFICIENT_FUNDS: "La tarjeta no tiene fondos suficientes. Puedes intentarlo con otra tarjeta o con PSE.",
  INVALID_CARD_DATA:
    "El banco no aceptó los datos de la tarjeta. Revisa el número, la fecha y el código de seguridad, o intenta con otra tarjeta.",
  CARD_RESTRICTED: "El banco tiene restringida esta tarjeta. Comunícate con tu banco, o intenta con otra tarjeta o con PSE.",
  FRAUD_SUSPICION: "El pago no se aprobó por seguridad. Puedes intentarlo con otra tarjeta o con PSE.",
  NETWORK_ERROR: "El banco no respondió y el pago no se aprobó. Vuelve a intentarlo en unos minutos.",
  AUTHENTICATION_FAILED: "No se pudo confirmar que la tarjeta es tuya. Vuelve a intentarlo, o intenta con otra tarjeta.",
  DUPLICATED_PAYMENT: "Ya hay un pago igual a este. Revisa tus pagos antes de intentarlo otra vez.",
};

function resultDetail(order: Order): string {
  const category = order.status === "DECLINED" ? order.declineReason?.category : undefined;
  return category && category !== "UNKNOWN" ? DECLINE_DETAILS[category] : RESULTS[order.status].detail;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatPesos(amount: number): string {
  return `$${amount.toLocaleString("es-CO")} COP`;
}

/**
 * La franja de arriba dice dónde se cobra. La tienda no nombra pasarelas: sus nombres llegan del
 * módulo de pagos, así que agregar una cambia solo el módulo, y no estas páginas (puntos 111 y 117).
 */
const RIBBONS: Record<CheckoutEnvironment, string> = {
  sandbox: "Tienda de demostración · cobra en el sandbox oficial de cada pasarela, sin dinero real",
  simulator: "Tienda de demostración · cobra en la API de Simulación de Kit Pagos, sin dinero real",
};

/** Datos para el script de la página, sin que un `<` cierre la etiqueta. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function layout(title: string, main: string, environment: CheckoutEnvironment): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STORE_CSS}</style>
</head>
<body>
${COVER_SPRITE}
<p class="demo-ribbon">${RIBBONS[environment]}</p>
<header class="masthead">
  <div class="masthead__inner">
    <a class="brand" href="/">
      <span class="brand__mark" aria-hidden="true">LC</span>
      <span>
        <span class="brand__name">La Candelaria Cómics</span>
        <span class="brand__tagline">Cómics de DC y Marvel, desde La Candelaria, en Bogotá</span>
      </span>
    </a>
    <a class="cart-link" href="/#pedido">Tu pedido <span class="cart-link__count" id="cart-count">0</span></a>
  </div>
</header>
${main}
<footer class="footer">
  <p>La Candelaria Cómics · Bogotá · tienda de ejemplo</p>
  <p class="footer__small">Prototipo A de Kit Pagos Colombia: integración directa con las cuatro pasarelas, sin el SDK.</p>
</footer>
<script type="module" src="/assets/checkout.js"></script>
</body>
</html>`;
}

function productCard(product: Product): string {
  return `<li class="product">
      <div class="product__art"><svg viewBox="0 0 200 220" role="img" aria-label="Portada de ${escapeHtml(product.title)}"><use href="#${escapeHtml(product.art)}"></use></svg></div>
      <div class="product__body">
        <span class="product__hero">${escapeHtml(product.hero)}</span>
        <h3 class="product__title">${escapeHtml(product.title)}</h3>
        <p class="product__credits">${escapeHtml(product.credits)}</p>
        <p class="product__detail">${escapeHtml(product.detail)}</p>
        <p class="product__blurb">${escapeHtml(product.blurb)}</p>
        <div class="product__buy">
          <span class="price">${formatPesos(product.priceInPesos)}</span>
          <button type="button" class="add" data-product-id="${escapeHtml(product.id)}">Agregar al pedido</button>
        </div>
      </div>
    </li>`;
}

/** Las pasarelas del módulo de pagos, con el nombre que dio él: la tienda no nombra ninguna. */
function gatewayOptions(gateways: readonly GatewayOption[]): string {
  return gateways
    .map(
      (gateway) =>
        `<option value="${escapeHtml(gateway.id)}" data-card-capture="${escapeHtml(gateway.cardCapture)}">${escapeHtml(gateway.name)}</option>`,
    )
    .join("");
}

/** La vitrina, el carrito y el checkout. El carrito lo arma el script con los datos de `catalog-data`. */
export function storePage(
  products: readonly Product[],
  environment: CheckoutEnvironment,
  gateways: readonly GatewayOption[],
): string {
  const catalog = products.map(({ id, title, priceInPesos }) => ({ id, title, priceInPesos }));
  return layout(
    "La Candelaria Cómics · Cómics de DC y Marvel",
    `<main class="shop">
  <section class="catalog" aria-labelledby="catalog-title">
    <h1 class="catalog__title" id="catalog-title">Clásicos que no pueden faltar</h1>
    <aside class="about" aria-label="Sobre este prototipo">
      <p class="about__title">Este prototipo es</p>
      <p>
        El <strong>prototipo A de Kit Pagos Colombia</strong>, el grupo de control del experimento: una tienda que
        integra a mano las cuatro pasarelas, con <code>fetch</code> contra la API de cada una y siguiendo su
        documentación oficial, sin el SDK del framework.
      </p>
      <p>
        El prototipo B cobra con <code>kit-pagos-colombia</code>. El experimento compara el código de pagos de los
        dos y lo que cuesta agregarle a cada uno una pasarela más. Los pagos van al sandbox oficial o al simulador,
        sin dinero real.
      </p>
    </aside>
    <p class="catalog__intro">Tres historias que cambiaron a sus héroes. Despachamos a todo el país y el envío es gratis.</p>
    <ul class="products">
    ${products.map(productCard).join("\n    ")}
    </ul>
  </section>

  <aside class="order" id="pedido" aria-labelledby="order-title">
    <h2 id="order-title">Tu pedido</h2>
    <p class="order__empty" id="cart-empty">Todavía no has agregado nada. Elige un cómic de la izquierda.</p>
    <ul class="lines" id="cart-lines"></ul>
    <dl class="totals" id="cart-totals" hidden>
      <div><dt>Subtotal</dt><dd id="subtotal"></dd></div>
      <div><dt>Envío</dt><dd>Gratis</dd></div>
      <div class="totals__grand"><dt>Total</dt><dd id="total"></dd></div>
    </dl>

    <form id="checkout-form" class="checkout" hidden>
      <label>Pasarela
        <select id="gateway" name="gateway">${gatewayOptions(gateways)}</select>
      </label>
      <p class="hint">En una tienda real la pasarela la define el comercio. Aquí la eliges para probar las cuatro.</p>

      <details class="buyer">
        <summary>
          <span class="buyer__title">Tus datos</span>
          <span class="buyer__summary" id="buyer-summary">Pedro Pérez · pedro@example.com</span>
        </summary>
        <div class="grid">
          <label class="grid__wide">Nombre completo <input id="fullName" name="fullName" value="Pedro Pérez" required></label>
          <label class="grid__wide">Correo <input id="email" name="email" type="email" value="pedro@example.com" required></label>
          <label>Documento
            <select id="documentType" name="documentType">
              <option value="CC">Cédula de ciudadanía</option>
              <option value="CE">Cédula de extranjería</option>
              <option value="NIT">NIT</option>
              <option value="PP">Pasaporte</option>
            </select>
          </label>
          <label>Número <input id="documentNumber" name="documentNumber" value="1020304050" required></label>
          <label class="grid__wide">Celular <input id="phone" name="phone" value="3001234567" required></label>
          <label>Calle <input id="streetName" name="streetName" value="Calle 10" required></label>
          <label>Número <input id="streetNumber" name="streetNumber" value="5-20" required></label>
          <label>Barrio <input id="neighborhood" name="neighborhood" value="La Candelaria" required></label>
          <label>Ciudad <input id="city" name="city" value="Bogotá" required></label>
          <label class="grid__wide">Código postal <input id="zipCode" name="zipCode" value="111711" required></label>
        </div>
      </details>

      <fieldset class="methods">
        <legend>¿Cómo quieres pagar?</legend>
        <label class="method"><input type="radio" name="method" value="CARD" checked><span>Tarjeta</span><small>Crédito o débito</small></label>
        <label class="method"><input type="radio" name="method" value="PSE"><span>PSE</span><small>Débito desde tu banco</small></label>
      </fieldset>

      <div id="card-fields" class="grid">
        <label class="grid__wide">Número de la tarjeta <input id="cardNumber" value="4242 4242 4242 4242" inputmode="numeric" autocomplete="cc-number"></label>
        <label>Mes <input id="expMonth" value="12" inputmode="numeric" autocomplete="cc-exp-month"></label>
        <label>Año <input id="expYear" value="30" inputmode="numeric" autocomplete="cc-exp-year"></label>
        <label>CVC <input id="cvc" value="123" inputmode="numeric" autocomplete="cc-csc"></label>
        <label>Cuotas <input id="installments" type="number" min="1" max="36" value="1"></label>
        <label class="grid__wide">Nombre en la tarjeta <input id="cardHolder" value="PEDRO PEREZ" autocomplete="cc-name"></label>
        <p class="hint grid__wide">Datos de prueba precargados. La tarjeta va del navegador a la pasarela; la tienda solo recibe un token.</p>
      </div>
      <p id="hosted-card" class="hint" hidden>Con esta pasarela, la tarjeta se escribe en su propia página: al pagar te llevamos allá.</p>

      <div id="pse-fields" class="grid" hidden>
        <label class="grid__wide">Tu banco <select id="bankCode"></select></label>
        <label class="grid__wide">Tipo de persona
          <select id="personType">
            <option value="NATURAL">Natural</option>
            <option value="LEGAL">Jurídica</option>
          </select>
        </label>
      </div>

      <button type="submit" class="pay" id="pay-button">Pagar</button>
      <p class="form-error" id="message" role="alert"></p>
    </form>
  </aside>
</main>
<script type="application/json" id="catalog-data">${jsonForScript(catalog)}</script>`,
    environment,
  );
}

/** El código del rechazo, si lo hay, va junto al detalle: es lo que se audita. */
function historyDetail(entry: StatusRecord): string {
  const decline = entry.declineReason ? `Rechazo ${describeDecline(entry.declineReason)}` : "";
  return [decline, entry.detail ?? ""].filter(Boolean).join(" · ");
}

function historyRows(order: Order): string {
  return order.history
    .map(
      (entry) => `<tr>
          <td>${escapeHtml(entry.at)}</td>
          <td>${SOURCE_LABELS[entry.source]}</td>
          <td>${STATUS_LABELS[entry.status]}</td>
          <td>${escapeHtml(entry.nativeStatus ?? "")}</td>
          <td>${escapeHtml(historyDetail(entry))}</td>
        </tr>`,
    )
    .join("\n");
}

function summaryLines(order: Order): string {
  return order.lines
    .map(
      (line) => `<li class="line">
        <span class="line__name">${escapeHtml(line.title)}</span>
        <span class="line__price">${formatPesos(line.quantity * line.unitPriceInPesos)}</span>
        <span class="line__detail">${line.quantity} × ${formatPesos(line.unitPriceInPesos)}</span>
      </li>`,
    )
    .join("\n      ");
}

/** La orden: el resultado para el comprador y, plegado, el historial con el estado nativo (función 6). */
export function orderPage(order: Order, environment: CheckoutEnvironment, gatewayName: string): string {
  const result = RESULTS[order.status];
  return layout(
    `Orden ${order.id} · La Candelaria Cómics`,
    `<main class="result">
  <article class="result__card result--${order.status}" id="order-result" data-status="${order.status}">
    <div class="result__icon" aria-hidden="true">${result.icon}</div>
    <h1>${result.title}</h1>
    <p id="order-detail">${resultDetail(order)}</p>
    <p class="result__ref">Orden ${escapeHtml(order.id)} · ${order.method === "CARD" ? "Tarjeta" : "PSE"} con ${escapeHtml(gatewayName)} · Estado: <strong id="order-status">${STATUS_LABELS[order.status]}</strong></p>
    <ul class="lines lines--summary">
      ${summaryLines(order)}
    </ul>
    <dl class="totals"><div class="totals__grand"><dt>Total</dt><dd>${formatPesos(order.amountInPesos)}</dd></div></dl>
    <div class="result__actions">
      <button type="button" class="pay" id="refresh-order" data-order-id="${escapeHtml(order.id)}">Consultar el estado</button>
      <a class="secondary" href="/">Seguir comprando</a>
    </div>
    <p class="form-error" id="message" role="status"></p>
    <details class="audit">
      <summary>Detalle técnico de la orden</summary>
      <p>Transacción en la pasarela: <code>${escapeHtml(order.transactionId ?? "sin crear")}</code>. El historial guarda el estado que dijo la pasarela, sin traducir, para auditoría.</p>
      <table>
        <thead><tr><th>Fecha</th><th>Origen</th><th>Estado</th><th>Estado nativo</th><th>Detalle</th></tr></thead>
        <tbody>
        ${historyRows(order)}
        </tbody>
      </table>
    </details>
  </article>
</main>`,
    environment,
  );
}

export function notFoundPage(environment: CheckoutEnvironment): string {
  return layout(
    "Orden no encontrada · La Candelaria Cómics",
    `<main class="result">
  <article class="result__card">
    <h1>Orden no encontrada</h1>
    <p>No tenemos una orden con ese número.</p>
    <div class="result__actions"><a class="secondary" href="/">Volver a la tienda</a></div>
  </article>
</main>`,
    environment,
  );
}
