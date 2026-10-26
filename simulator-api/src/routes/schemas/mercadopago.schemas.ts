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
          details: { type: "array", items: { type: "string" } },
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
    401: {
      description:
        "Access token inexistente (las marcas de `invalidCredential.ts`): " +
        "`{ code: \"unauthorized\", message: \"user not found\" }`, medido.",
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
 * Crea una orden de PSE o de tarjeta. Requiere x-idempotency-key.
 * PSE no va por /payments sino por esta API (issue #64), y desde el SDK 0.6.0 la tarjeta
 * tampoco (punto 96 del architecture-log.md).
 *
 * Este schema documenta y no rechaza (`attachValidation` en la ruta): Mercado Pago revisa la
 * llave de idempotencia antes que el cuerpo, y el handler responde lo medido cuando falta algo
 * (`400 required_properties` en una orden de tarjeta sin `id`, `type` o `token`). El cuerpo no
 * marca campos obligatorios porque PSE y tarjeta piden campos distintos.
 */
export const postMpOrdersSchema = {
  summary: "Crear orden Mercado Pago (PSE o tarjeta)",
  description:
    "Simula `POST /v1/orders` de Mercado Pago, que atiende PSE y tarjeta. " +
    "**Requiere la cabecera `x-idempotency-key`** (Mercado Pago responde " +
    "400 \"Missing HTTP header: X-Idempotency-Key.\" si falta; " +
    "el mensaje es distinto al de /payments). La llave se revisa después de la credencial y " +
    "antes del cuerpo: repetirla con el mismo cuerpo devuelve la respuesta guardada, y con " +
    "otro cuerpo responde 409. " +
    "Es de tarjeta si `payment_method.type` es `credit_card` o `debit_card`, o si trae " +
    "`token`; si no, es de PSE. Una orden de tarjeta sin `id`, `type` o `token` responde " +
    "400 `required_properties`, y una de débito con más de una cuota 400 `property_value`. " +
    "PSE con APPROVED nace `action_required` con la URL del banco; la tarjeta aprobada nace " +
    "`processed` / `accredited`; REJECTED/DECLINED responde 402 con la orden en `data`. " +
    "Los montos viajan como **string**. La API real rechaza el PSE con centavos ('2000.50'); " +
    "el simulador lo acepta, y un monto con centavos nunca coincide con un monto reservado.",
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
    properties: {
      type: { type: "string", example: "online" },
      total_amount: {
        type: "string",
        description: "Monto total como string (p.ej. '150000'). En PSE, la API real no admite centavos.",
        example: "150000",
      },
      external_reference: { type: "string" },
      processing_mode: { type: "string" },
      payer: {
        type: "object",
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
        properties: {
          payments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                amount: { type: "string", example: "150000" },
                payment_method: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      description: "`pse` en PSE; la marca (`visa`, `master`) en tarjeta.",
                      example: "pse",
                    },
                    type: {
                      type: "string",
                      description: "`bank_transfer` en PSE; `credit_card` o `debit_card` en tarjeta.",
                      example: "bank_transfer",
                    },
                    financial_institution: {
                      type: "string",
                      description: "Solo PSE: el código del banco.",
                      example: "1051",
                    },
                    token: {
                      type: "string",
                      description: "Solo tarjeta: el `id` de `POST /v1/sim/mercadopago/card_tokens`.",
                    },
                    installments: {
                      type: "integer",
                      description: "Solo tarjeta: las cuotas. Débito admite solo 1.",
                      example: 1,
                    },
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
        "Orden creada. En PSE, `action_required` (el pagador debe ir al banco); en tarjeta " +
        "aprobada, `processed` / `accredited`.",
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
        capture_mode: { type: "string", description: "Solo tarjeta." },
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
                  paid_amount: { type: "string", description: "Solo tarjeta." },
                  reference_id: { type: "string" },
                  status: { type: "string" },
                  status_detail: { type: "string" },
                  payment_method: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      type: { type: "string" },
                      redirect_url: { type: "string", format: "uri", description: "Solo PSE." },
                      financial_institution: { type: "string", description: "Solo PSE." },
                      token: { type: "string", description: "Solo tarjeta." },
                      installments: { type: "integer", description: "Solo tarjeta." },
                      installment_amount: { type: "string", description: "Solo tarjeta." },
                      transaction_security: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      examples: [
        {
          id: "ORD010ZETC3YU86",
          type: "online",
          processing_mode: "automatic",
          external_reference: "ord-card-001",
          total_amount: "20000",
          total_paid_amount: "20000",
          country_code: "COL",
          status: "processed",
          status_detail: "accredited",
          capture_mode: "automatic_async",
          currency: "COP",
          created_date: "2026-10-19T15:09:58.687Z",
          last_updated_date: "2026-10-19T15:09:58.687Z",
          config: { online: { transaction_security: { validation: "never" } } },
          transactions: {
            payments: [
              {
                id: "PAY010QH2NVCVEY",
                amount: "20000",
                paid_amount: "20000",
                reference_id: "oab3c66oxn",
                status: "processed",
                status_detail: "accredited",
                payment_method: {
                  id: "visa",
                  type: "credit_card",
                  token: "tok_sim_mp_tcz237t2ip",
                  installments: 1,
                  installment_amount: "20000",
                  transaction_security: { validation: "never" },
                },
              },
            ],
          },
        },
      ],
    },
    400: {
      description:
        "Cabecera x-idempotency-key faltante (`empty_required_header`), o una orden de tarjeta " +
        "sin `id`, `type` o `token` (`required_properties`) o de débito con más de una cuota " +
        "(`property_value`).",
      ...mpOrdersErrorBody,
    },
    402: {
      description:
        "Orden rechazada (escenarios REJECTED/DECLINED, o el titular de la tarjeta). " +
        "Mercado Pago usa 402 para indicar que las transacciones fallaron, y trae la orden " +
        "fallida en `data`.",
      type: "object",
      properties: {
        ...mpOrdersErrorBody.properties,
        data: { type: "object", additionalProperties: true },
      },
    },
    409: {
      description: "La llave de idempotencia ya se usó con otro cuerpo.",
      ...mpOrdersErrorBody,
    },
    423: {
      description: "Otra petición con la misma llave de idempotencia sigue en curso.",
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
  summary: "Consultar orden Mercado Pago (PSE o tarjeta)",
  description:
    "Simula `GET /v1/orders/:id` de Mercado Pago. " +
    "Por defecto un PSE devuelve la orden con `status: processed` " +
    "(como si el pagador ya completó la transferencia bancaria). " +
    "Devuelve la orden persistida: en PSE, el estado resultante de su flujo; en tarjeta, el " +
    "mismo de la creación. " +
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
    "Use el `id` devuelto como `token` en POST /v1/sim/mercadopago/orders (SDK 0.6.0) o en " +
    "POST /v1/sim/mercadopago/payments (SDK 0.5.0), junto con las cuotas y " +
    "x-idempotency-key. Las respuestas POST, incluidos los errores, " +
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

/**
 * GET /v1/sim/mercadopago/card_tokens/:id
 *
 * La primera lectura del SDK 0.6.0 antes de una orden de tarjeta: de aquí saca el BIN.
 * `Authorization` no se marca obligatoria porque el handler responde el `401` medido.
 */
export const getMpCardTokenSchema = {
  summary: "Leer un token de tarjeta Mercado Pago",
  description:
    "Simula `GET /v1/card_tokens/:id` de Mercado Pago, con el access token del comercio. " +
    "Devuelve el token emitido por `POST /v1/sim/mercadopago/card_tokens`, con el BIN en " +
    "`first_six_digits`, sin el titular; leerlo no lo consume. Sin `Authorization` responde " +
    "401 con la causa `E212`. **Diferencia deliberada con la API real:** un token que el " +
    "simulador no emitió no responde 404, sino la tarjeta de prueba Visa crédito, para que " +
    "los ejemplos que cobran con tokens inventados sigan funcionando.",
  tags: ["Mercado Pago Simulación"],
  params: {
    type: "object",
    properties: {
      id: { type: "string", description: "El `id` del token", example: "tok_sim_mp_tcz237t2ip" },
    },
  },
  headers: {
    type: "object",
    properties: {
      authorization: {
        type: "string",
        description: "`Bearer` con el access token del comercio.",
        example: "Bearer APP_USR-...",
      },
    },
  },
  response: {
    200: {
      description: "El token, sin el titular.",
      type: "object",
      properties: {
        id: { type: "string" },
        public_key: { type: "string" },
        live_mode: { type: "boolean" },
        require_esc: { type: "boolean" },
        status: { type: "string" },
        first_six_digits: { type: "string" },
        last_four_digits: { type: "string" },
        card_number_length: { type: "integer" },
        trunc_card_number: { type: "string" },
        luhn_validation: { type: "boolean" },
        expiration_month: { type: "integer" },
        expiration_year: { type: "integer" },
        security_code_length: { type: "integer" },
        date_created: { type: "string", format: "date-time" },
        date_last_updated: { type: "string", format: "date-time" },
        date_due: { type: "string", format: "date-time" },
      },
      examples: [
        {
          id: "tok_sim_mp_tcz237t2ip",
          public_key: "APP_USR-pub-prueba",
          live_mode: true,
          require_esc: false,
          status: "active",
          first_six_digits: "401354",
          last_four_digits: "6260",
          card_number_length: 16,
          trunc_card_number: "401354XXXXXX6260",
          luhn_validation: true,
          expiration_month: 11,
          expiration_year: 2030,
          security_code_length: 3,
          date_created: "2026-10-19T15:09:58.666Z",
          date_last_updated: "2026-10-19T15:09:58.666Z",
          date_due: "2026-10-27T15:09:58.666Z",
        },
      ],
    },
    401: {
      description:
        "Sin `Authorization` (causa `E212`), o con un access token inexistente (causa vacía).",
      ...mpPaymentsErrorBody,
    },
  },
} as const;

/**
 * GET /v1/sim/mercadopago/payment_methods/search
 *
 * La segunda lectura del SDK 0.6.0 antes de una orden de tarjeta: la marca y el tipo del BIN.
 * `public_key` no se marca obligatoria porque el handler responde el `400` medido.
 */
export const getMpPaymentMethodSearchSchema = {
  summary: "Buscar los medios de pago de un BIN en Mercado Pago",
  description:
    "Simula `GET /v1/payment_methods/search` de Mercado Pago. Devuelve la marca y el tipo " +
    "(`credit_card` o `debit_card`) de un BIN, que la Orders API exige en la orden de tarjeta. " +
    "Sin `public_key` responde 400 \"public_key is required\" aunque llegue el Bearer, y con " +
    "una llave pública inexistente 404 \"public key not found\".",
  tags: ["Mercado Pago Simulación"],
  querystring: {
    type: "object",
    properties: {
      public_key: { type: "string", description: "Llave pública del comercio.", example: "APP_USR-..." },
      bins: { type: "string", description: "Los seis primeros dígitos.", example: "401354" },
      marketplace: { type: "string", example: "NONE" },
      status: { type: "string", example: "active" },
    },
  },
  response: {
    200: {
      description: "Los medios de pago del BIN.",
      type: "object",
      properties: {
        paging: {
          type: "object",
          properties: {
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
        },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              payment_type_id: { type: "string" },
              status: { type: "string" },
            },
          },
        },
      },
      examples: [
        {
          paging: { total: 1, limit: 30, offset: 0 },
          results: [{ id: "visa", name: "Visa", payment_type_id: "credit_card", status: "active" }],
        },
      ],
    },
    400: {
      description: "Sin `public_key`.",
      type: "object",
      properties: { code: { type: "integer" }, message: { type: "string" } },
    },
    404: {
      description: "Llave pública inexistente.",
      type: "object",
      properties: { code: { type: "integer" }, message: { type: "string" } },
    },
  },
} as const;
