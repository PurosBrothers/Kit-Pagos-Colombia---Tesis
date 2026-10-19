/**
 * Schemas OpenAPI/JSON-Schema para las rutas de simulación de Mercado Pago.
 *
 * Particularidades documentadas aquí porque son las que un integrador
 * descubre a golpes contra la API real:
 *
 * - `x-idempotency-key` es **obligatoria** en POST /payments y POST /orders.
 *   Cada API se queja distinto si falta: payments responde 400 con
 *   "Header X-Idempotency-Key can't be null" y orders responde 400 con
 *   "Missing HTTP header: X-Idempotency-Key.".
 *
 * - Los estados de Mercado Pago son en **minúsculas** (`approved`, `rejected`,
 *   `pending`), a diferencia de Wompi (mayúsculas).
 *
 * - La respuesta de Mercado Pago es un **objeto plano** (sin envoltorio `data`).
 *
 * - PSE va por `/orders`, no por `/payments` (issue #64).
 *   Los estados de orders son distintos: `action_required`, `processed`, `failed`.
 *
 * - En creación, `x-simulate-scenario` admite escenarios de negocio y técnicos.
 *   Orders rechaza con 501 los escenarios de creación no soportados; las consultas
 *   leen el estado persistido y no usan esa cabecera.
 *
 * - Los GET de pagos y órdenes consultan el estado guardado al crearlos.
 *
 * - El 501 es parte del contrato: escenario todavía no soportado.
 */

// ─── Fragmentos reutilizables ────────────────────────────────────────────────

/** Cabecera de escenario para las rutas de Mercado Pago. */
const mpSimulateScenarioHeader = {
  type: "string",
  description:
    "Escenario solicitado en rutas de creación. Valores de negocio admitidos incluyen " +
    "APPROVED, APPROVAL, REJECTED, DECLINED, EXPIRED y PENDING; también se admiten " +
    "escenarios técnicos TIMEOUT, GATEWAY_TIMEOUT, NETWORK_ERROR, CONNECTION_ERROR, " +
    "RATE_LIMIT, TOO_MANY_REQUESTS, SERVER_ERROR, INTERNAL_ERROR, BAD_GATEWAY, " +
    "SERVICE_UNAVAILABLE, FLAPPING, DUPLICATE_PAYMENT, SLOW, MALFORMED_JSON, " +
    "MALFORMED_BODY, HTML_ERROR, 429, 500, 502, 503 e INVALID_CREDENTIALS. " +
    "Orders admite solo el subconjunto implementado " +
    "y responde 501 para los escenarios de creación no soportados.",
  example: "APPROVED",
} as const;

/** Payer de Mercado Pago. */
const mpPayer = {
  type: "object",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email", example: "cliente@ejemplo.com" },
    first_name: { type: "string" },
    last_name: { type: "string" },
    identification: {
      type: "object",
      properties: {
        type: { type: "string", example: "CC" },
        number: { type: "string", example: "123456789" },
      },
    },
  },
} as const;

/** Respuesta de pago plana de Mercado Pago (sin envoltorio data). */
const mpPaymentResponseObject = {
  type: "object",
  properties: {
    id: {
      oneOf: [{ type: "integer" }, { type: "string" }],
      description: "Identificador numérico de Mercado Pago",
      example: 1234567890,
    },
    status: {
      type: "string",
      enum: ["approved", "pending", "in_process", "rejected", "cancelled"],
      description: "Estado en minúsculas (convención de Mercado Pago, distinta a Wompi)",
      example: "approved",
    },
    status_detail: { type: "string", example: "accredited" },
    transaction_amount: {
      type: "number",
      description: "Monto en pesos COP (unidad mayor con decimales), no en centavos",
      example: 50000,
    },
    currency_id: { type: "string", enum: ["COP"], example: "COP" },
    description: { type: "string" },
    external_reference: { type: "string" },
    payer: mpPayer,
    date_created: { type: "string", format: "date-time" },
    date_approved: { type: ["string", "null"], format: "date-time" },
  },
  required: ["id", "status", "transaction_amount", "currency_id", "payer"],
} as const;

/** Forma de error estándar de Mercado Pago (payments API). */
const mpPaymentsErrorBody = {
  type: "object",
  properties: {
    message: { type: "string" },
    error: { type: "string" },
    code: { type: "string" },
    status: { type: "integer" },
    cause: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { oneOf: [{ type: "integer" }, { type: "string" }] },
          description: { type: "string" },
          data: { type: "string" },
        },
      },
    },
  },
} as const;

/** Forma de error estándar de Mercado Pago (orders API). */
const mpOrdersErrorBody = {
  type: "object",
  properties: {
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: { type: "string" },
        },
      },
    },
  },
} as const;

// ─── Schemas por ruta ────────────────────────────────────────────────────────

/**
 * POST /v1/sim/mercadopago/payments
 *
 * Crea un pago con tarjeta. Requiere x-idempotency-key.
 */
export const postMpPaymentsSchema = {
  summary: "Crear pago Mercado Pago (tarjeta)",
  description:
    "Simula `POST /v1/payments` de Mercado Pago. " +
    "**Requiere la cabecera `x-idempotency-key`** (Mercado Pago responde " +
    "400 si falta: \"Header X-Idempotency-Key can't be null\"). " +
    "Requiere token e installments; si falta cualquiera el handler responde 400 " +
    "con el mensaje nativo correspondiente. " +
    "PSE no va por esta ruta sino por POST /v1/sim/mercadopago/orders. " +
    "Los estados de Mercado Pago son en minúsculas (`approved`, `rejected`).",
  tags: ["Mercado Pago Simulación"],
  headers: {
    type: "object",
    required: ["x-idempotency-key"],
    properties: {
      "x-idempotency-key": {
        type: "string",
        description:
          "Clave de idempotencia **obligatoria**. " +
          "Sin ella el simulador responde 400 igual que la API real.",
        example: "idempotency-key-abc123",
      },
      "x-simulate-scenario": mpSimulateScenarioHeader,
      "x-simulator-scenario": {
        ...mpSimulateScenarioHeader,
        description: "Alias de x-simulate-scenario.",
      },
    },
  },
  body: {
    type: "object",
    required: ["transaction_amount", "token", "installments", "payer"],
    properties: {
      transaction_amount: {
        type: "number",
        minimum: 0.01,
        description: "Monto en pesos COP (decimales permitidos, no en centavos)",
        example: 50000,
      },
      description: { type: "string", example: "Compra en mi tienda" },
      external_reference: { type: "string", example: "orden-001" },
      token: {
        type: "string",
        description:
          "Token de tarjeta. **Obligatorio para cobros con tarjeta** " +
          "(sin él Mercado Pago responde 400 \"payment_method_id attribute can't be null\").",
        example: "tok_test_abc123",
      },
      installments: {
        type: "integer",
        minimum: 1,
        description:
          "Cuotas. **Obligatorio incluso cuando es 1** " +
          "(sin él Mercado Pago responde 400 \"Invalid installments\").",
        example: 1,
      },
      payment_method_id: { type: "string", example: "visa" },
      payer: mpPayer,
    },
    additionalProperties: true,
    examples: [
      {
        transaction_amount: 50000,
        description: "Compra en mi tienda",
        token: "tok_test_abc123",
        installments: 1,
        payer: { email: "cliente@ejemplo.com" },
      },
    ],
  },
  response: {
    201: {
      description:
        "Pago creado. status 'approved' para APPROVED, 'rejected' para REJECTED/DECLINED.",
      ...mpPaymentResponseObject,
      examples: [
        {
          id: 1234567890,
          status: "approved",
          status_detail: "accredited",
          transaction_amount: 50000,
          currency_id: "COP",
          description: "Compra en mi tienda",
          payer: { email: "cliente@ejemplo.com" },
          date_created: "2026-09-21T23:52:46.000Z",
          date_approved: "2026-09-21T23:52:46.000Z",
        },
      ],
    },
    400: {
      description:
        "Cuerpo inválido o cabecera x-idempotency-key faltante. " +
        "El mensaje y la estructura varían según qué falta.",
      ...mpPaymentsErrorBody,
    },
    409: {
      description: "Pago duplicado (escenario DUPLICATE_PAYMENT).",
      ...mpPaymentsErrorBody,
    },
    501: {
      description: "Escenario todavía no soportado.",
      type: "object",
      properties: { error: { type: "string" } },
    },
  },
} as const;

/**
 * GET /v1/sim/mercadopago/payments/:id
 *
 * Consulta el estado persistido del pago.
 */
export const getMpPaymentSchema = {
  summary: "Consultar pago Mercado Pago",
  description:
    "Simula `GET /v1/payments/:id` de Mercado Pago. " +
    "Devuelve el pago guardado al crearlo y su estado actual; no vuelve a elegir el desenlace " +
    "desde una cabecera de escenario. Si el identificador no existe, responde 404.",
  tags: ["Mercado Pago Simulación"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description: "Identificador del pago",
        example: "1234567890",
      },
    },
  },
  response: {
    200: {
      description: "Pago encontrado con el estado persistido de su creación.",
      ...mpPaymentResponseObject,
      examples: [
        {
          id: "1234567890",
          status: "approved",
          status_detail: "accredited",
          transaction_amount: 50000,
          currency_id: "COP",
          description: "Consulta de pago 1234567890",
          payer: { email: "customer@example.com" },
          date_created: "2026-09-21T23:52:46.000Z",
          date_approved: "2026-09-21T23:52:46.000Z",
        },
      ],
    },
    404: {
      description: "Pago no encontrado.",
      ...mpPaymentsErrorBody,
    },
  },
} as const;

/**
 * POST /v1/sim/mercadopago/orders
 *
 * Crea una orden PSE. Requiere x-idempotency-key.
 * PSE no va por /payments sino por esta API (issue #64).
 */
export const postMpOrdersSchema = {
  summary: "Crear orden PSE Mercado Pago",
  description:
    "Simula `POST /v1/orders` de Mercado Pago (API exclusiva para PSE). " +
    "**Requiere la cabecera `x-idempotency-key`** (Mercado Pago responde " +
    "400 \"Missing HTTP header: X-Idempotency-Key.\" si falta; " +
    "el mensaje es distinto al de /payments). " +
    "La respuesta tiene `status: action_required` para APPROVED " +
    "y 402 con `errors[].code = 'failed'` para REJECTED/DECLINED. " +
    "Los montos viajan como **string sin decimales** (la API real rechaza '2000.00').",
  tags: ["Mercado Pago Simulación"],
  headers: {
    type: "object",
    required: ["x-idempotency-key"],
    properties: {
      "x-idempotency-key": {
        type: "string",
        description: "Clave de idempotencia **obligatoria**.",
        example: "idempotency-key-pse-001",
      },
      "x-simulate-scenario": mpSimulateScenarioHeader,
      "x-simulator-scenario": {
        ...mpSimulateScenarioHeader,
        description: "Alias de x-simulate-scenario.",
      },
    },
  },
  body: {
    type: "object",
    required: ["total_amount", "payer", "transactions"],
    properties: {
      type: { type: "string", example: "online" },
      total_amount: {
        type: "string",
        description: "Monto total como string sin decimales (p.ej. '150000', no '150000.00')",
        example: "150000",
        pattern: "^\\d+$",
      },
      external_reference: { type: "string" },
      processing_mode: { type: "string" },
      payer: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email", example: "cliente@ejemplo.com" },
          entity_type: { type: "string", example: "individual" },
          phone: {
            type: "object",
            properties: {
              area_code: { type: "string" },
              number: { type: "string" },
            },
          },
          address: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      transactions: {
        type: "object",
        required: ["payments"],
        properties: {
          payments: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["amount", "payment_method"],
              properties: {
                amount: { type: "string", example: "150000", pattern: "^\\d+$" },
                payment_method: {
                  type: "object",
                  required: ["id", "type"],
                  properties: {
                    id: { type: "string", example: "pse" },
                    type: { type: "string", example: "bank_transfer" },
                    financial_institution: { type: "string", example: "1051" },
                  },
                },
              },
            },
          },
        },
      },
      additional_info: { type: "object", additionalProperties: true },
      config: {
        type: "object",
        properties: {
          online: {
            type: "object",
            properties: {
              callback_url: { type: "string", format: "uri" },
            },
          },
        },
      },
    },
  },
  response: {
    201: {
      description:
        "Orden creada con status `action_required` (el pagador debe ir al banco).",
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "string" },
        processing_mode: { type: "string" },
        external_reference: { type: "string" },
        total_amount: { type: "string" },
        total_paid_amount: { type: "string" },
        country_code: { type: "string" },
        status: {
          type: "string",
          enum: ["created", "processing", "action_required", "processed", "canceled", "failed", "expired"],
        },
        status_detail: { type: "string" },
        currency: { type: "string" },
        created_date: { type: "string", format: "date-time" },
        last_updated_date: { type: "string", format: "date-time" },
        payer: { type: "object", properties: { entity_type: { type: "string" } } },
        config: { type: "object", additionalProperties: true },
        transactions: {
          type: "object",
          properties: {
            payments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  amount: { type: "string" },
                  reference_id: { type: "string" },
                  status: { type: "string" },
                  status_detail: { type: "string" },
                  payment_method: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      type: { type: "string" },
                      redirect_url: { type: "string", format: "uri" },
                      financial_institution: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    400: {
      description: "Cabecera x-idempotency-key faltante.",
      ...mpOrdersErrorBody,
    },
    402: {
      description:
        "Orden rechazada (escenarios REJECTED/DECLINED). " +
        "Mercado Pago usa 402 para indicar que las transacciones fallaron.",
      ...mpOrdersErrorBody,
    },
    501: {
      description: "Escenario todavía no soportado.",
      type: "object",
      properties: { error: { type: "string" } },
    },
  },
} as const;

/**
 * GET /v1/sim/mercadopago/orders/:id
 *
 * Consulta una orden. Por defecto devuelve processed (pagada).
 * PENDING devuelve action_required.
 */
export const getMpOrderSchema = {
  summary: "Consultar orden PSE Mercado Pago",
  description:
    "Simula `GET /v1/orders/:id` de Mercado Pago. " +
    "Por defecto devuelve la orden con `status: processed` " +
    "(como si el pagador ya completó la transferencia bancaria). " +
    "Devuelve la orden persistida y el estado resultante de su flujo PSE. " +
    "La cabecera de escenario no cambia una orden ya creada; un identificador inexistente " +
    "responde 404.",
  tags: ["Mercado Pago Simulación"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description: "Identificador de la orden",
        example: "ord-abc-001",
      },
    },
  },
  response: {
    200: {
      description: "Orden encontrada.",
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "string" },
        processing_mode: { type: "string" },
        total_amount: { type: "string" },
        total_paid_amount: { type: "string" },
        country_code: { type: "string" },
        status: {
          type: "string",
          enum: ["created", "processing", "action_required", "processed", "canceled", "failed", "expired"],
          example: "processed",
        },
        status_detail: { type: "string" },
        currency: { type: "string" },
        created_date: { type: "string", format: "date-time" },
        last_updated_date: { type: "string", format: "date-time" },
        payer: { type: "object", properties: { entity_type: { type: "string" } } },
        transactions: { type: "object", additionalProperties: true },
      },
      examples: [
        {
          id: "ord-abc-001",
          type: "online",
          processing_mode: "automatic",
          total_amount: "150000",
          total_paid_amount: "150000",
          country_code: "CO",
          status: "processed",
          status_detail: "paid",
          currency: "COP",
          created_date: "2026-09-21T23:52:46.000Z",
          last_updated_date: "2026-09-21T23:52:46.000Z",
          payer: { entity_type: "individual" },
        },
      ],
    },
    404: {
      description: "Orden no encontrada.",
      ...mpOrdersErrorBody,
    },
  },
} as const;

/**
 * GET /v1/sim/mercadopago/payment_methods
 *
 * Catálogo de métodos de pago. PSE se anida dentro de la entrada `pse`
 * bajo `financial_institutions`.
 */
export const getMpPaymentMethodsSchema = {
  summary: "Listar métodos de pago Mercado Pago",
  description:
    "Simula `GET /v1/payment_methods` de Mercado Pago. " +
    "Mercado Pago no tiene endpoint separado de bancos PSE: " +
    "las entidades van anidadas en la entrada `pse` bajo `financial_institutions`. " +
    "El mock devuelve cinco de las 47 entidades medidas más un método que no es PSE " +
    "(para que el filtro del SDK pueda verificarse). " +
    "`min_allowed_amount` y `max_allowed_amount` son los valores reales medidos.",
  tags: ["Mercado Pago Simulación"],
  response: {
    200: {
      description: "Lista de métodos de pago disponibles.",
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", example: "pse" },
          name: { type: "string", example: "PSE" },
          payment_type_id: { type: "string", example: "bank_transfer" },
          status: { type: "string", example: "active" },
          min_allowed_amount: { type: "number", example: 1600 },
          max_allowed_amount: { type: "number", example: 340000000 },
          financial_institutions: {
            type: "array",
            description: "Solo presente en el método PSE.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", example: "1007" },
                description: { type: "string", example: "Bancolombia" },
              },
              required: ["id", "description"],
            },
          },
        },
        required: ["id", "name", "payment_type_id", "status"],
      },
      examples: [
        [
          { id: "master", name: "Mastercard", payment_type_id: "credit_card", status: "active" },
          {
            id: "pse",
            name: "PSE",
            payment_type_id: "bank_transfer",
            status: "active",
            min_allowed_amount: 1600,
            max_allowed_amount: 340000000,
            financial_institutions: [
              { id: "1001", description: "Banco de Bogotá" },
              { id: "1007", description: "Bancolombia" },
              { id: "1013", description: "BBVA" },
              { id: "1051", description: "Davivienda" },
              { id: "1019", description: "DAVIbank S.A." },
            ],
          },
        ],
      ],
    },
  },
} as const;

/**
 * POST /v1/sim/mercadopago/card_tokens (issue #127)
 *
 * Tokenización de tarjeta de crédito en Mercado Pago.
 */
export const postMpTokenCardSchema = {
  summary: "Tokenizar tarjeta de crédito Mercado Pago",
  description:
    "Simula `POST /v1/card_tokens` de Mercado Pago. " +
    "Requiere el parámetro `public_key` en la query; si falta, el handler responde 401. " +
    "Esta ruta no exige Authorization; Mercado Pago responde 400 si se envía esa cabecera. " +
    "Use el `id` devuelto como `token` en POST /v1/sim/mercadopago/payments, junto con " +
    "installments y x-idempotency-key. Las respuestas POST, incluidos los errores, " +
    "permiten CORS desde cualquier origen.",
  tags: ["Mercado Pago Simulación"],
  querystring: {
    type: "object",
    required: ["public_key"],
    properties: {
      public_key: {
        type: "string",
        description: "Llave pública de Mercado Pago (APP_USR-... o PUBLIC_KEY)",
        example: "APP_USR-test-123456",
      },
    },
  },
  headers: {
    type: "object",
    properties: {
      "x-simulate-scenario": {
        ...mpSimulateScenarioHeader,
        description:
          "Escenario técnico para fallas de tokenización; los escenarios de negocio no " +
          "alteran la emisión del token.",
      },
      "x-simulator-scenario": {
        ...mpSimulateScenarioHeader,
        description:
          "Alias de x-simulate-scenario. Solo se aplican escenarios técnicos.",
      },
    },
  },
  body: {
    type: "object",
    properties: {
      card_number: { type: "string", example: "4509950000000000" },
      expiration_month: { type: "integer", example: 12 },
      expiration_year: { type: "integer", example: 2030 },
      security_code: { type: "string", example: "123" },
      cardholder: {
        type: "object",
        properties: {
          name: { type: "string", example: "APRO" },
          identification: {
            type: "object",
            properties: {
              type: { type: "string", example: "CC" },
              number: { type: "string", example: "12345678" },
            },
          },
        },
      },
    },
  },
  response: {
    201: {
      description: "Tarjeta tokenizada exitosamente.",
      type: "object",
      properties: {
        id: { type: "string", example: "ff8080814c11e237014c1ff59f0f0000" },
        public_key: { type: "string" },
        live_mode: { type: "boolean", example: false },
        require_esc: { type: "boolean", example: false },
        status: { type: "string", example: "active" },
        first_six_digits: { type: "string", example: "450995" },
        last_four_digits: { type: "string", example: "0000" },
        card_number_length: { type: "integer", example: 16 },
        trunc_card_number: { type: "string", example: "450995XXXXXX0000" },
        expiration_month: { type: "integer", example: 12 },
        expiration_year: { type: "integer", example: 2030 },
        security_code_length: { type: "integer", example: 3 },
        luhn_validation: { type: "boolean", example: true },
        date_created: { type: "string", format: "date-time" },
        date_last_updated: { type: "string", format: "date-time" },
        date_due: { type: "string", format: "date-time" },
        cardholder: {
          type: "object",
          properties: {
            name: { type: "string" },
            identification: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    400: {
      description: "Petición malformada o Authorization Bearer enviado en vez de query public_key.",
      ...mpPaymentsErrorBody,
    },
    401: {
      description: "Sin parámetro public_key en la consulta.",
      ...mpPaymentsErrorBody,
    },
    500: {
      description: "Llave pública inexistente.",
      ...mpPaymentsErrorBody,
    },
    429: { description: "Límite de solicitudes simulado.", ...mpPaymentsErrorBody },
    502: { description: "Error de gateway simulado.", ...mpPaymentsErrorBody },
    503: { description: "Servicio no disponible simulado.", ...mpPaymentsErrorBody },
    504: { description: "Tiempo de espera agotado simulado.", ...mpPaymentsErrorBody },
  },
} as const;
