import {
  SNIPPET_UNIFIED_FULL,
  SNIPPET_GATEWAY_CREDS,
  SNIPPET_DISPARITY_WOMPI,
  SNIPPET_DISPARITY_MERCADOPAGO,
  SNIPPET_REST_CURL,
} from "./snippets";

// Resaltador de sintaxis TypeScript liviano y sin dependencias externas
function highlightTypeScript(code: string): string {
  const htmlEscaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = htmlEscaped.split("\n");

  const highlightedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      return `<span class="tok-cm">${line}</span>`;
    }

    let parsed = line;

    // Resaltar cadenas de texto
    parsed = parsed.replace(
      /(&quot;[\s\S]*?&quot;|'[\s\S]*?'|`[\s\S]*?`)/g,
      '<span class="tok-str">$1</span>',
    );

    // Resaltar palabras clave de TypeScript / JavaScript
    const keywords = [
      "import", "export", "from", "const", "let", "var", "async", "await",
      "new", "return", "function", "type", "interface", "declare", "as",
      "true", "false", "null", "undefined"
    ];
    const kwRegex = new RegExp(`\\b(${keywords.join("|")})\\b`, "g");
    parsed = parsed.replace(kwRegex, '<span class="tok-kw">$1</span>');

    // Resaltar números
    parsed = parsed.replace(/\b(\d+)\b/g, '<span class="tok-num">$1</span>');

    return parsed;
  });

  return highlightedLines.join("\n");
}

function highlightBash(code: string): string {
  const htmlEscaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return htmlEscaped
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        return `<span class="tok-cm">${line}</span>`;
      }
      return line
        .replace(/\b(curl|cd|npm|run|install|build|dev)\b/g, '<span class="tok-kw">$1</span>')
        .replace(/(-X|-H|-d)\b/g, '<span class="tok-fn">$1</span>')
        .replace(/(&quot;[\s\S]*?&quot;|'[\s\S]*?')/g, '<span class="tok-str">$1</span>');
    })
    .join("\n");
}

// Datos detallados del Sandbox Explorer
interface SandboxInfo {
  name: string;
  hostUrl: string;
  cards: Array<{ type: string; number: string; exp: string; cvc: string; outcome: string }>;
  rules: string[];
  quirk: string;
}

const SANDBOX_DATA: Record<string, SandboxInfo> = {
  wompi: {
    name: "Wompi Colombia",
    hostUrl: "https://sandbox.wompi.co/v1",
    cards: [
      { type: "Crédito / Débito", number: "4242 4242 4242 4242", exp: "Futuro", cvc: "123", outcome: "APPROVED" },
      { type: "Crédito / Débito", number: "4111 1111 1111 1111", exp: "Futuro", cvc: "123", outcome: "DECLINED" },
    ],
    rules: [
      "Llave pública con prefijo pub_test_* enviada en cabecera 'Authorization: Bearer <pub_key>'.",
      "Firma de integridad obligatoria: SHA256(referencia + centavos + COP + integritySecret).",
      "Token de aceptación previo: debe pedirse a GET /merchants/{pub_key} antes de cobrar.",
      "El cobro nace como PENDING y transiciona asíncronamente a APPROVED o DECLINED.",
    ],
    quirk: "En el sandbox de Wompi, la URL de redirección de PSE aparece en el mismo instante en que se resuelve el pago. Para probar redirección real se utiliza la API de Simulación local.",
  },
  mercadopago: {
    name: "Mercado Pago",
    hostUrl: "https://api.mercadopago.com",
    cards: [
      { type: "Mastercard Crédito", number: "5254 1336 7440 3564", exp: "11/30", cvc: "123", outcome: "Según titular (APRO)" },
      { type: "Visa Crédito", number: "4013 5406 8274 6260", exp: "11/30", cvc: "123", outcome: "Según titular (APRO)" },
      { type: "Visa Débito", number: "4915 1120 5524 6507", exp: "11/30", cvc: "123", outcome: "Según titular (APRO)" },
    ],
    rules: [
      "Access Token con prefijo APP_USR-* en cabecera 'Authorization: Bearer <token>'.",
      "Cabecera X-Idempotency-Key obligatoria (UUID v4 generado por petición) o responde HTTP 400.",
      "Cuotas obligatorias: el campo 'installments: 1' debe viajar siempre, incluso en pagos de 1 cuota.",
      "Nombres del titular para forzar estado: APRO (aprobado), FUND (sin fondos), CALL (autorizar), SECU (CVV inválido), EXPI (vencida). Documento: 123456789.",
      "Comprador de prueba obligatorio: test@testuser.com.",
    ],
    quirk: "La Orders API de PSE responde HTTP 401 con credenciales de prueba de sandbox y exige token de producción. El SDK permite probar PSE de Mercado Pago de punta a punta gracias a la API de Simulación.",
  },
  kushki: {
    name: "Kushki",
    hostUrl: "https://api-uat.kushkipagos.com",
    cards: [
      { type: "Aprobada", number: "5451 9515 7492 5480", exp: "Futuro", cvc: "123", outcome: "APPROVED (000)" },
      { type: "Declinada en token", number: "4574 4412 1519 0335", exp: "Futuro", cvc: "123", outcome: "Tarjeta no válida (017)" },
      { type: "Rechazada en cobro", number: "4349 0030 0004 7015", exp: "Futuro", cvc: "123", outcome: "Tarjeta no válida (017)" },
      { type: "Sin fondos", number: "4349 0012 1084 6432", exp: "Futuro", cvc: "123", outcome: "Tarjeta sin fondos (021)" },
      { type: "CVV inválido", number: "4349 0032 4337 1321", exp: "Futuro", cvc: "123", outcome: "Error CVV (022)" },
    ],
    rules: [
      "Tokenizador frontend usa cabecera 'Public-Merchant-Id'.",
      "Cobros de backend usan cabecera 'Private-Merchant-Id'.",
      "Ruta de cobro es /card/v1/charges con el parámetro 'fullResponse: true' obligatorio para recibir estado y desglose de IVA.",
      "PSE se denomina 'Transfer In' y requiere dos llamadas internas (creación de token + inicialización).",
    ],
    quirk: "La consulta de estado de tarjeta síncrona en Kushki responde CAS004 'No existe la transacción' en el API oficial. El SDK maneja esto retornando el estado capturado en la creación o mediante webhooks.",
  },
  rapyd: {
    name: "Rapyd",
    hostUrl: "https://sandboxapi.rapyd.net/v1",
    cards: [
      { type: "Aprobada (CLO)", number: "4111 1111 1111 1111", exp: "Futuro", cvc: "123", outcome: "APPROVED (CLO + paid)" },
      { type: "Aprobada alternativa", number: "4462 0300 0000 0000", exp: "Futuro", cvc: "123", outcome: "APPROVED (CLO + paid)" },
    ],
    rules: [
      "Autenticación criptográfica por petición: firma HMAC-SHA256 combinando ruta, timestamp, salt y access_key con el secret_key.",
      "Manejo de tarjetas vía Hosted Checkout (/v1/checkout): Rapyd no permite cobrar tokens de tarjeta servidor-a-servidor sin recibir el plástico completo, por lo que el SDK usa redirección segura para no meter al comercio en alcance PCI DSS.",
      "Catálogo PSE extenso: Rapyd modela cada banco como un método individual con el patrón 'co_pse_{banco}_bank'.",
    ],
    quirk: "El estado de pago final en Rapyd es 'CLO' (Closed). El SDK normaliza esto verificando simultáneamente 'status === CLO' y 'paid === true' para emitir 'APPROVED'.",
  },
};

function renderSandboxContent(gatewayKey: string): void {
  const data = SANDBOX_DATA[gatewayKey];
  const container = document.getElementById("sandbox-content");
  if (!container || !data) return;

  const rows = data.cards
    .map((c) => {
      let outcomeClass = "status-neutral";
      const lower = c.outcome.toLowerCase();
      if (lower.includes("approved") || lower.includes("aprobada") || lower.includes("apro")) {
        outcomeClass = "status-approved";
      } else if (
        lower.includes("declin") ||
        lower.includes("rechazada") ||
        lower.includes("error") ||
        lower.includes("fondos") ||
        lower.includes("no válida")
      ) {
        outcomeClass = "status-declined";
      } else if (lower.includes("clo")) {
        outcomeClass = "status-warning";
      }

      return `<tr>
        <td><strong class="card-type-name">${c.type}</strong></td>
        <td><code class="card-num-box">${c.number}</code></td>
        <td class="text-secondary">${c.exp}</td>
        <td><code class="card-cvc-box">${c.cvc}</code></td>
        <td><span class="outcome-cell ${outcomeClass}"><span class="outcome-dot"></span>${c.outcome}</span></td>
      </tr>`;
    })
    .join("");

  const ruleItems = data.rules
    .map((r) => `<li class="sandbox-rule-item"><span class="rule-bullet">•</span><span>${r}</span></li>`)
    .join("");

  container.innerHTML = `
    <div class="sandbox-header-box">
      <div class="sandbox-host-info">
        <span class="sandbox-host-label">URL Oficial de Sandbox:</span>
        <code class="sandbox-host-url">${data.hostUrl}</code>
      </div>
      <button type="button" class="btn-copy btn-copy-sm" data-copy-text="${data.hostUrl}">Copiar URL</button>
    </div>

    <div class="sandbox-grid">
      <div class="sandbox-table-col">
        <h4 class="sandbox-section-title">Tarjetas de Prueba Documentadas</h4>
        <div class="table-container">
          <table class="data-table sandbox-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Número de tarjeta</th>
                <th>Exp</th>
                <th>CVC</th>
                <th>Resultado esperado</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="sandbox-rules-col">
        <h4 class="sandbox-section-title">Requisitos Técnicos y Cabeceras</h4>
        <ul class="sandbox-rule-list">
          ${ruleItems}
        </ul>
      </div>
    </div>

    <div class="sandbox-quirk-box">
      <strong>Particularidad de Sandbox:</strong> ${data.quirk}
    </div>
  `;

  // Reconectar botones de copia dentro del contenido recién insertado
  setupCopyButtons(container);
}

let isFullUnifiedSnippet = false;

function getUnifiedSnippetCode(activeGateway: string): string {
  if (isFullUnifiedSnippet) {
    return SNIPPET_UNIFIED_FULL.replace(
      /gateway:\s*Gateway\.\w+,/g,
      `gateway: Gateway.${activeGateway},`,
    );
  }

  const creds = SNIPPET_GATEWAY_CREDS[activeGateway] || SNIPPET_GATEWAY_CREDS.WOMPI;
  return `import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  PaymentMethod,
} from "kit-pagos-colombia";

// 1. Instanciar pasarela activa (lo único que cambia para alternar)
const kitPagos = new KitPagos({
  gateway: Gateway.${activeGateway}, // <- Alternar por WOMPI, MERCADOPAGO, KUSHKI o RAPYD
  credentials: {
${creds}
  },
});

// 2. Cobro unificado: idéntico para cualquier pasarela
const resultado = await kitPagos.createPayment({
  amount: new Amount("150000.00"),
  currency: new Currency("COP"),
  orderReference: new OrderReference("ORDER-1042"),
  payer: new Payer({
    email: "cliente@example.com",
    fullName: "Jaime Pavlich",
  }),
  paymentMethod: PaymentMethod.card("tok_test_card_12345"),
});`;
}

function updateUnifiedSnippet(activeGateway?: string): void {
  const codeEl = document.getElementById("code-snippet-unified");
  if (!codeEl) return;

  const currentGw =
    activeGateway ||
    document.querySelector(".demo-tab.is-active, .tab-btn.is-active")?.getAttribute("data-gateway") ||
    "WOMPI";

  codeEl.innerHTML = highlightTypeScript(getUnifiedSnippetCode(currentGw));
}

function setupCopyButtons(root: Document | HTMLElement = document): void {
  const buttons = root.querySelectorAll<HTMLButtonElement>(".btn-copy");
  buttons.forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      let textToCopy = "";
      const copyTarget = btn.getAttribute("data-copy");
      const directText = btn.getAttribute("data-copy-text");

      if (directText) {
        textToCopy = directText;
      } else if (copyTarget === "snippet-wompi") {
        textToCopy = SNIPPET_DISPARITY_WOMPI;
      } else if (copyTarget === "snippet-mercadopago") {
        textToCopy = SNIPPET_DISPARITY_MERCADOPAGO;
      } else if (copyTarget === "snippet-unified") {
        const activeTab =
          document.querySelector(".demo-tab.is-active, .tab-btn.is-active")?.getAttribute("data-gateway") || "WOMPI";
        textToCopy = getUnifiedSnippetCode(activeTab);
      } else if (copyTarget === "snippet-rest") {
        textToCopy = SNIPPET_REST_CURL;
      }

      if (textToCopy) {
        try {
          await navigator.clipboard.writeText(textToCopy);
          const originalText = btn.textContent;
          btn.textContent = "Copiado";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove("copied");
          }, 2000);
        } catch {
          // Fallback silencioso si el clipboard está restringido
        }
      }
    };
  });
}

function init(): void {
  // Renderizar snippets en terminales
  const wompiEl = document.getElementById("code-snippet-wompi");
  if (wompiEl) wompiEl.innerHTML = highlightTypeScript(SNIPPET_DISPARITY_WOMPI);

  const mpEl = document.getElementById("code-snippet-mercadopago");
  if (mpEl) mpEl.innerHTML = highlightTypeScript(SNIPPET_DISPARITY_MERCADOPAGO);

  const restEl = document.getElementById("code-snippet-rest");
  if (restEl) restEl.innerHTML = highlightBash(SNIPPET_REST_CURL);

  updateUnifiedSnippet("WOMPI");

  // Botón para alternar entre vista compacta y configuración completa
  const toggleSnippetBtn = document.getElementById("btn-toggle-unified");
  if (toggleSnippetBtn) {
    toggleSnippetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      isFullUnifiedSnippet = !isFullUnifiedSnippet;
      toggleSnippetBtn.textContent = isFullUnifiedSnippet
        ? "Ver código esencial ▴"
        : "Ver config. completa ▾";
      updateUnifiedSnippet();
    });
  }
  const demoTabs = document.querySelectorAll<HTMLButtonElement>(".demo-tab, .tab-btn");
  demoTabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      demoTabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const gw = tab.getAttribute("data-gateway") || "WOMPI";
      updateUnifiedSnippet(gw);
    });
  });

  // Manejo de tabs en sandbox explorer (soporta ambas clases .sandbox-tab y .console-tab)
  const sandboxTabs = document.querySelectorAll<HTMLButtonElement>(".sandbox-tab, .console-tab");
  sandboxTabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      sandboxTabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const key = tab.getAttribute("data-sandbox") || "wompi";
      renderSandboxContent(key);
    });
  });

  // Render inicial del sandbox explorer
  renderSandboxContent("wompi");

  // Configurar botones de copia
  setupCopyButtons();

  // Menú móvil toggle
  const toggleBtn = document.getElementById("menu-toggle");
  const mobileNav = document.getElementById("mobile-nav");
  if (toggleBtn && mobileNav) {
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const isOpen = mobileNav.classList.toggle("is-open");
      toggleBtn.setAttribute("aria-expanded", String(isOpen));
      mobileNav.setAttribute("aria-hidden", String(!isOpen));
    });

    mobileNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mobileNav.classList.remove("is-open");
        toggleBtn.setAttribute("aria-expanded", "false");
        mobileNav.setAttribute("aria-hidden", "true");
      });
    });
  }
}

// Inicializar al cargar el DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
