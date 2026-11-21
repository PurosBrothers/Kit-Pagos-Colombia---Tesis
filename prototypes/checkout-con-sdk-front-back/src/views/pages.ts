import { Product } from "../catalog";
import { CheckoutEnvironment } from "../checkout/environment";
import { DeclineCategory, GatewayOption } from "../checkout/PaymentsPort";
import { describeDecline, Order, OrderStatus, StatusRecord, StatusSource } from "../orders/OrderStore";
import { BOTTLE_SPRITE } from "./art";
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
    detail: "Ya estamos empacando tus vinos. Te escribimos cuando salgan para tu casa.",
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

const MONITOR_ENV_LABELS: Record<CheckoutEnvironment, string> = {
  sandbox: "Sandbox real",
  simulator: "Simulador local",
};

/** Datos para el script de la página, sin que un `<` cierre la etiqueta. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function layout(title: string, main: string, environment: CheckoutEnvironment, orderCount = 0): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STORE_CSS}</style>
</head>
<body>
${BOTTLE_SPRITE}
<p class="demo-ribbon">${RIBBONS[environment]}</p>
<header class="masthead">
  <div class="masthead__inner">
    <a class="brand" href="/">
      <span class="brand__mark" aria-hidden="true">BC</span>
      <span>
        <span class="brand__name">La Bodega de Chapinero</span>
        <span class="brand__tagline">Vinos de Chile, Argentina y Colombia, desde Chapinero, en Bogotá</span>
      </span>
    </a>
    <nav class="masthead__nav" aria-label="Navegación de la tienda">
      <a class="nav-link" href="/orders">Mis pedidos <span class="nav-link__count" id="orders-count">${orderCount}</span></a>
      <a class="cart-link" href="/#pedido">Tu pedido <span class="cart-link__count" id="cart-count">0</span></a>
      <button type="button" class="monitor-toggle" id="monitor-toggle" aria-controls="sdk-monitor" aria-expanded="false">Monitor SDK</button>
    </nav>
  </div>
</header>
${main}
<footer class="footer">
  <p>La Bodega de Chapinero · Bogotá · tienda de ejemplo</p>
  <p class="footer__legal">El exceso de alcohol es perjudicial para la salud (Ley 30 de 1986). Prohíbase el expendio de bebidas embriagantes a menores de edad (Ley 124 de 1994).</p>
  <p class="footer__small">Prototipo B de Kit Pagos Colombia: cobra con el SDK <code>kit-pagos-colombia</code>.</p>
</footer>
<section class="sdk-monitor" id="sdk-monitor" aria-label="Monitor del flujo SDK en vivo" data-collapsed="true">
  <div class="sdk-monitor__bar">
    <div class="sdk-monitor__title">
      <span class="sdk-monitor__dot" aria-hidden="true"></span>
      <strong>Monitor SDK en vivo</strong>
      <span class="sdk-monitor__env">${MONITOR_ENV_LABELS[environment]}</span>
    </div>
    <div class="sdk-monitor__controls">
      <label class="sdk-monitor__pause"><input type="checkbox" id="monitor-pause"> Modo paso a paso</label>
      <button type="button" class="sdk-monitor__btn" id="monitor-clear">Limpiar</button>
      <button type="button" class="sdk-monitor__btn" id="monitor-collapse" aria-expanded="false">Expandir</button>
    </div>
  </div>
  <div class="sdk-monitor__body" id="sdk-monitor-body" hidden>
    <ol class="sdk-pipeline" aria-label="Etapas del pago">
      <li class="sdk-stage" data-stage="front" data-state="idle"><span class="sdk-stage__num">1</span><strong>Frontend</strong><small class="sdk-stage__status">En espera</small></li>
      <li class="sdk-stage" data-stage="browser" data-state="idle"><span class="sdk-stage__num">2</span><strong>SDK Navegador</strong><small class="sdk-stage__status">Tokenización</small></li>
      <li class="sdk-stage" data-stage="backend" data-state="idle"><span class="sdk-stage__num">3</span><strong>Backend SDK</strong><small class="sdk-stage__status">KitPagos</small></li>
      <li class="sdk-stage" data-stage="sandbox" data-state="idle"><span class="sdk-stage__num">4</span><strong>Pasarela</strong><small class="sdk-stage__status">HTTP externo</small></li>
      <li class="sdk-stage" data-stage="response" data-state="idle"><span class="sdk-stage__num">5</span><strong>Respuesta</strong><small class="sdk-stage__status">Normalizada</small></li>
    </ol>
    <div class="sdk-monitor__continue-bar" id="monitor-continue-bar" hidden>
      <span id="monitor-continue-text"></span>
      <button type="button" class="sdk-monitor__continue" id="monitor-continue-btn">Continuar →</button>
    </div>
    <p class="sdk-log__empty" id="monitor-empty">Oprime «Pagar» o «Consultar estado» para ver cada salto del flujo en tiempo real.</p>
    <ol class="sdk-log" id="monitor-log"></ol>
  </div>
</section>
<script type="module" src="/assets/checkout.js"></script>
</body>
</html>`;
}

function productCard(product: Product): string {
  return `<li class="product">
      <div class="product__art"><svg viewBox="0 0 200 220" role="img" aria-label="Botella de ${escapeHtml(product.title)}"><use href="#${escapeHtml(product.art)}"></use></svg></div>
      <div class="product__body">
        <span class="product__origin">${escapeHtml(product.origin)}</span>
        <h3 class="product__title">${escapeHtml(product.title)}</h3>
        <p class="product__winery">${escapeHtml(product.winery)}</p>
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
  orderCount = 0,
): string {
  const catalog = products.map(({ id, title, priceInPesos }) => ({ id, title, priceInPesos }));
  return layout(
    "La Bodega de Chapinero · Vinos de Chile, Argentina y Colombia",
    `<main class="shop">
  <section class="catalog" aria-labelledby="catalog-title">
    <h1 class="catalog__title" id="catalog-title">Tres tintos para la mesa</h1>
    <aside class="about" aria-label="Sobre este prototipo">
      <p class="about__title">Este prototipo es</p>
      <p>
        El <strong>prototipo B de Kit Pagos Colombia</strong>, el grupo de tratamiento del experimento: una tienda
        con el mismo esqueleto que el prototipo D, cuyo módulo de pagos cobra las cuatro pasarelas con
        <code>kit-pagos-colombia</code>, el SDK del framework, en vez de integrarlas a mano.
      </p>
      <p>
        El prototipo D integra cada pasarela con <code>fetch</code>, siguiendo su documentación oficial. El
        experimento compara el código de pagos de los dos y lo que cuesta agregarle a cada uno una pasarela más. Los
        pagos van al sandbox oficial o al simulador, sin dinero real.
      </p>
    </aside>
    <p class="catalog__intro">Un chileno, un argentino y uno de Boyacá. Despachamos a todo el país y el envío es gratis.</p>
    <ul class="products">
    ${products.map(productCard).join("\n    ")}
    </ul>
  </section>

  <aside class="order" id="pedido" aria-labelledby="order-title">
    <h2 id="order-title">Tu pedido</h2>
    <p class="order__empty" id="cart-empty">Todavía no has agregado nada. Elige un vino de la izquierda.</p>
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
          <label>Calle <input id="streetName" name="streetName" value="Carrera 13" required></label>
          <label>Número <input id="streetNumber" name="streetNumber" value="63-39" required></label>
          <label>Barrio <input id="neighborhood" name="neighborhood" value="Chapinero" required></label>
          <label>Ciudad <input id="city" name="city" value="Bogotá" required></label>
          <label class="grid__wide">Código postal <input id="zipCode" name="zipCode" value="110231" required></label>
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

      <label class="adult"><input type="checkbox" id="adult" name="adult" required> Confirmo que soy mayor de edad</label>

      <button type="submit" class="pay" id="pay-button">Pagar</button>
      <p class="form-error" id="message" role="alert"></p>
    </form>
  </aside>
</main>
<script type="application/json" id="catalog-data">${jsonForScript(catalog)}</script>`,
    environment,
    orderCount,
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
export function orderPage(
  order: Order,
  environment: CheckoutEnvironment,
  gatewayName: string,
  orderCount = 0,
): string {
  const result = RESULTS[order.status];
  return layout(
    `Orden ${order.id} · La Bodega de Chapinero`,
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
      <a class="secondary" href="/orders">Ver mis pedidos</a>
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
    orderCount,
  );
}

function orderSummaryCard(order: Order, gatewayLabel: string): string {
  const items = order.lines.map((line) => `${line.quantity} × ${line.title}`).join(", ");
  const latestNative = order.history[order.history.length - 1]?.nativeStatus ?? "—";
  const eventsCount = order.history.length;
  const decline =
    order.status === "DECLINED" && order.declineReason
      ? ` · Rechazo ${escapeHtml(describeDecline(order.declineReason))}`
      : "";
  const refreshButton = order.transactionId
    ? `<button type="button" class="refresh-inline" data-refresh-order="${escapeHtml(order.id)}">Consultar estado</button>`
    : "";

  return `<li class="order-item" data-order-id="${escapeHtml(order.id)}" data-status="${order.status}">
      <div class="order-item__top">
        <div class="order-item__title">
          <a class="order-item__id" href="/orders/${escapeHtml(order.id)}">${escapeHtml(order.id)}</a>
          <span class="badge badge--${order.status}">${STATUS_LABELS[order.status]}</span>
          <span class="order-item__date">${escapeHtml(order.createdAt)}</span>
        </div>
        <strong class="order-item__total">${formatPesos(order.amountInPesos)}</strong>
      </div>
      <p class="order-item__meta">${order.method === "CARD" ? "Tarjeta" : "PSE"} con ${escapeHtml(gatewayLabel)} · ${escapeHtml(order.payer.fullName)} · ${escapeHtml(items)}</p>
      <p class="order-item__audit">Transacción: <code>${escapeHtml(order.transactionId ?? "sin crear")}</code> · Estado nativo: <code>${escapeHtml(latestNative)}</code> · ${eventsCount} ${eventsCount === 1 ? "evento" : "eventos"}${decline}</p>
      <div class="order-item__actions">
        <a class="secondary" href="/orders/${escapeHtml(order.id)}">Ver detalle y auditoría</a>
        ${refreshButton}
      </div>
    </li>`;
}

/** Historial de órdenes de la sesión con estado normalizado, estado nativo y consulta puntual. */
export function ordersPage(
  orders: readonly Order[],
  environment: CheckoutEnvironment,
  gatewayName: (id: string) => string,
): string {
  const approved = orders.filter((order) => order.status === "APPROVED").length;
  const pending = orders.filter((order) => order.status === "PENDING").length;
  const failed = orders.filter((order) => order.status === "DECLINED" || order.status === "ERROR").length;
  const body =
    orders.length === 0
      ? `<article class="result__card">
    <h2>Sin pedidos todavía</h2>
    <p>Todavía no has hecho ningún pedido en esta sesión.</p>
    <div class="result__actions"><a class="pay" href="/">Ir al catálogo</a></div>
  </article>`
      : `<section class="orders-kpis" aria-label="Resumen de pedidos">
    <div class="kpi"><span class="kpi__label">Total</span><strong class="kpi__value">${orders.length}</strong></div>
    <div class="kpi"><span class="kpi__label">Aprobados</span><strong class="kpi__value">${approved}</strong></div>
    <div class="kpi"><span class="kpi__label">Pendientes</span><strong class="kpi__value">${pending}</strong></div>
    <div class="kpi"><span class="kpi__label">Rechazados / Error</span><strong class="kpi__value">${failed}</strong></div>
  </section>
  <ul class="orders-list">
    ${orders.map((order) => orderSummaryCard(order, gatewayName(order.gateway))).join("\n    ")}
  </ul>`;

  return layout(
    "Mis pedidos · La Bodega de Chapinero",
    `<main class="orders-page">
  <div class="orders-header">
    <div>
      <h1>Mis pedidos</h1>
      <p>Seguimiento de las órdenes de esta sesión con su estado normalizado y el estado nativo devuelto por cada pasarela.</p>
    </div>
    <a class="secondary" href="/">Volver a la tienda</a>
  </div>
  <p class="form-error" id="orders-message" role="alert"></p>
  ${body}
</main>`,
    environment,
    orders.length,
  );
}

export function notFoundPage(environment: CheckoutEnvironment, orderCount = 0): string {
  return layout(
    "Orden no encontrada · La Bodega de Chapinero",
    `<main class="result">
  <article class="result__card">
    <h1>Orden no encontrada</h1>
    <p>No tenemos una orden con ese número.</p>
    <div class="result__actions">
      <a class="secondary" href="/orders">Ver mis pedidos</a>
      <a class="secondary" href="/">Volver a la tienda</a>
    </div>
  </article>
</main>`,
    environment,
    orderCount,
  );
}
