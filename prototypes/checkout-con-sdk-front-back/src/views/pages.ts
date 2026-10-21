import { Product } from "../catalog";
import { Order, OrderStatus, StatusSource } from "../orders/OrderStore";

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

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; color: #222; }
    fieldset { margin-bottom: 1rem; }
    label { display: block; margin: 0.5rem 0 0.2rem; }
    input, select { width: 100%; padding: 0.4rem; box-sizing: border-box; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.3rem; text-align: left; font-size: 0.9rem; }
    #message { margin-top: 1rem; font-weight: bold; }
  </style>
</head>
<body>
${body}
<script type="module" src="/assets/checkout.js"></script>
</body>
</html>`;
}

export function productPage(product: Product): string {
  return layout(
    product.name,
    `<h1>${escapeHtml(product.name)}</h1>
<p>${escapeHtml(product.description)}</p>
<p><strong>${formatPesos(product.priceInPesos)}</strong></p>
<form id="checkout-form">
  <fieldset>
    <legend>Datos del pagador</legend>
    <label for="fullName">Nombre completo</label>
    <input id="fullName" name="fullName" required>
    <label for="email">Correo</label>
    <input id="email" name="email" type="email" required>
    <label for="documentType">Tipo de documento</label>
    <select id="documentType" name="documentType">
      <option value="CC">Cédula de ciudadanía</option>
      <option value="CE">Cédula de extranjería</option>
      <option value="NIT">NIT</option>
      <option value="PP">Pasaporte</option>
    </select>
    <label for="documentNumber">Número de documento</label>
    <input id="documentNumber" name="documentNumber" required>
    <label for="phone">Teléfono</label>
    <input id="phone" name="phone" required>
  </fieldset>
  <fieldset>
    <legend>Medio de pago</legend>
    <label><input type="radio" name="method" value="CARD" checked> Tarjeta</label>
    <label><input type="radio" name="method" value="PSE"> PSE</label>
  </fieldset>
  <fieldset id="card-fields">
    <legend>Tarjeta</legend>
    <label for="cardNumber">Número</label>
    <input id="cardNumber" autocomplete="cc-number">
    <label for="cardHolder">Titular</label>
    <input id="cardHolder" autocomplete="cc-name">
    <label for="expMonth">Mes de vencimiento</label>
    <input id="expMonth" placeholder="MM">
    <label for="expYear">Año de vencimiento</label>
    <input id="expYear" placeholder="AA">
    <label for="cvc">CVC</label>
    <input id="cvc" autocomplete="cc-csc">
    <label for="installments">Cuotas</label>
    <input id="installments" type="number" min="1" value="1">
  </fieldset>
  <fieldset id="pse-fields" hidden>
    <legend>PSE</legend>
    <label for="bankCode">Banco</label>
    <select id="bankCode"></select>
    <label for="personType">Tipo de persona</label>
    <select id="personType">
      <option value="NATURAL">Natural</option>
      <option value="LEGAL">Jurídica</option>
    </select>
  </fieldset>
  <button type="submit">Pagar ${formatPesos(product.priceInPesos)}</button>
</form>
<p id="message" role="status"></p>`,
  );
}

export function orderPage(order: Order): string {
  const rows = order.history
    .map(
      (entry) => `<tr>
      <td>${escapeHtml(entry.at)}</td>
      <td>${SOURCE_LABELS[entry.source]}</td>
      <td>${STATUS_LABELS[entry.status]}</td>
      <td>${escapeHtml(entry.nativeStatus ?? "")}</td>
      <td>${escapeHtml(entry.detail ?? "")}</td>
    </tr>`,
    )
    .join("\n");
  return layout(
    `Orden ${order.id}`,
    `<h1>Orden ${escapeHtml(order.id)}</h1>
<p>Estado: <strong id="order-status">${STATUS_LABELS[order.status]}</strong></p>
<p>Monto: ${formatPesos(order.amountInPesos)} · Medio: ${order.method === "CARD" ? "Tarjeta" : "PSE"}</p>
<p>Transacción en la pasarela: ${escapeHtml(order.transactionId ?? "sin crear")}</p>
<button id="refresh-order" data-order-id="${escapeHtml(order.id)}">Consultar estado</button>
<h2>Historial</h2>
<table>
  <thead><tr><th>Fecha</th><th>Origen</th><th>Estado</th><th>Estado nativo</th><th>Detalle</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
<p id="message" role="status"></p>
<p><a href="/">Volver a la tienda</a></p>`,
  );
}

export function notFoundPage(): string {
  return layout("Orden no encontrada", `<h1>Orden no encontrada</h1><p><a href="/">Volver a la tienda</a></p>`);
}
