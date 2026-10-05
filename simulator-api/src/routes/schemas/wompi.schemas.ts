/**
 * Schemas OpenAPI/JSON-Schema para las rutas de simulación de Wompi.
 *
 * Cada schema se define una sola vez aquí y se reutiliza en el router.
 * De esta manera Fastify valida las peticiones entrantes, genera la
 * documentación en /docs, y el comportamiento de los handlers no cambia.
 *
 * Notas de diseño derivadas del architecture-log.md y del código medido:
 *
 * - `x-simulate-scenario`: el ScenarioEngine (issue #65) acepta los valores
 *   de negocio APPROVED, DECLINED, REJECTED, EXPIRED y los técnicos TIMEOUT,
 *   NETWORK_ERROR, RATE_LIMIT, SERVER_ERROR, BAD_GATEWAY, SERVICE_UNAVAILABLE,
 *   FLAPPING, DUPLICATE_PAYMENT. Cualquier otro valor devuelve 501.
 *
 * - El POST devuelve 201 con status PENDING, no APPROVED (punto 50 del
 *   architecture-log.md; un cobro con tarjeta de Wompi es asíncrono).
 *
 * - PSE: la primera consulta GET devuelve PENDING con async_payment_url; la
 *   segunda resuelve el estado final (punto 43 del architecture-log.md).
 *
 * - El 501 es parte del contrato: escenario todavía no soportado.
 */

// ─── Fragmentos reutilizables ────────────────────────────────────────────────

/** Cabecera de control de escenario, compartida por todas las rutas. */
const simulateScenarioHeader = {
  type: "string",
  description:
    "Escenario de simulación a ejecutar. " +
    "Wompi (vía ScenarioEngine) acepta: APPROVED, DECLINED, REJECTED, EXPIRED, " +
    "TIMEOUT, GATEWAY_TIMEOUT, NETWORK_ERROR, CONNECTION_ERROR, " +
    "RATE_LIMIT, TOO_MANY_REQUESTS, SERVER_ERROR, INTERNAL_ERROR, " +
    "BAD_GATEWAY, SERVICE_UNAVAILABLE, FLAPPING, DUPLICATE_PAYMENT. " +
    "Cualquier otro valor devuelve 501.",
  enum: [
    "APPROVED",
    "DECLINED",
    "REJECTED",
    "EXPIRED",
    "TIMEOUT",
    "GATEWAY_TIMEOUT",
    "NETWORK_ERROR",
    "CONNECTION_ERROR",
    "RATE_LIMIT",
    "TOO_MANY_REQUESTS",
    "SERVER_ERROR",
    "INTERNAL_ERROR",
    "BAD_GATEWAY",
    "SERVICE_UNAVAILABLE",
    "FLAPPING",
    "DUPLICATE_PAYMENT",
  ],
  example: "APPROVED",
} as const;

/** Forma de error nativa de Wompi (type + reason). */
const wompiErrorBody = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        type: { type: "string", description: "Código de error Wompi" },
        reason: { type: "string", description: "Descripción legible del error" },
        code: {
          type: "string",
          description: "Código auxiliar (solo en algunos errores, p. ej. MERCHANT_NOT_FOUND)",
        },
      },
      required: ["type"],
    },
  },
} as const;

/** Objeto transaction que devuelve Wompi dentro de `data`. */
const wompiTransactionObject = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid", description: "Identificador único de la transacción" },
    status: {
      type: "string",
      enum: ["PENDING", "APPROVED", "DECLINED", "ERROR", "VOIDED"],
      description:
        "Estado de la transacción. El simulador devuelve PENDING al crear " +
        "con tarjeta o PSE, porque Wompi es asíncrono (architecture-log punto 50).",
    },
    amount_in_cents: { type: "integer", minimum: 1, description: "Monto en centavos COP" },
    currency: { type: "string", enum: ["COP"], example: "COP" },
    reference: { type: "string", description: "Referencia única del comercio" },
    customer_email: { type: "string", format: "email" },
    payment_method: {
      type: "object",
      description:
        "Método de pago. Para PSE incluye extra.async_payment_url " +
        "solo en la primera consulta GET (flujo de dos pasos).",
      properties: {
        type: { type: "string", example: "PSE" },
        user_type: { type: "integer", example: 0 },
        user_legal_id: { type: "string", example: "123456789" },
        user_legal_id_type: { type: "string", example: "CC" },
        payment_description: { type: "string" },
        financial_institution_code: {
          type: "string",
          description: "Código de entidad PSE (1=aprueba, 2=declina, 3=error)",
        },
        extra: {
          type: "object",
          description:
            "Datos adicionales. async_payment_url aparece solo en la primera " +
            "consulta GET de un PSE (architecture-log punto 43).",
          additionalProperties: true,
        },
      },
    },
    redirect_url: { type: "string", format: "uri" },
  },
  required: ["id", "status", "amount_in_cents", "currency", "reference", "customer_email"],
} as const;

// ─── Schemas por ruta ────────────────────────────────────────────────────────

/**
 * POST /v1/sim/wompi/transactions
 *
 * Crea una transacción. El simulador responde 201 con status PENDING
 * (no APPROVED) porque Wompi cobra de forma asíncrona.
 */
export const postWompiTransactionsSchema = {
  summary: "Crear transacción Wompi",
  description:
    "Simula `POST /transactions` de Wompi. " +
    "Siempre devuelve 201 con `status: PENDING`, igual que la pasarela real (architecture-log punto 50). " +
    "Para PSE la respuesta también es PENDING y sin URL de redirección: " +
    "la URL aparece solo en la primera consulta GET subsiguiente (architecture-log punto 43). " +
    "El header `x-simulate-scenario` controla el escenario; sin él se asume APPROVED.",
  tags: ["Wompi Simulación"],
  headers: {
    type: "object",
    properties: {
      "x-simulate-scenario": simulateScenarioHeader,
      "x-simulator-scenario": {
        ...simulateScenarioHeader,
        description: "Alias de x-simulate-scenario (ambas cabeceras son aceptadas).",
      },
    },
  },
  body: {
    type: "object",
    required: ["amount_in_cents", "currency", "reference", "customer_email"],
    properties: {
      amount_in_cents: {
        type: "integer",
        minimum: 1,
        description: "Monto en centavos COP",
        example: 5000000,
      },
      currency: { type: "string", enum: ["COP"], example: "COP" },
      reference: {
        type: "string",
        description: "Referencia única del comercio",
        example: "ref-001",
      },
      customer_email: {
        type: "string",
        format: "email",
        example: "cliente@ejemplo.com",
      },
      payment_method: {
        type: "object",
        description:
          "Obligatorio. Sin este campo el simulador responde 422 " +
          "(replica el comportamiento medido contra sandbox.wompi.co).",
        properties: {
          type: { type: "string", example: "PSE" },
          user_type: { type: "integer", example: 0 },
          user_legal_id: { type: "string", example: "123456789" },
          user_legal_id_type: { type: "string", example: "CC" },
          payment_description: { type: "string" },
          financial_institution_code: {
            type: "string",
            description: "Código de banco PSE: '1' aprueba, '2' declina, '3' simula error",
            example: "1",
          },
        },
      },
      redirect_url: { type: "string", format: "uri", example: "https://mi-tienda.co/pago/resultado" },
      acceptance_token: { type: "string", description: "Token de aceptación de términos Wompi" },
      signature: { type: "string", description: "Firma de integridad (no validada por el simulador)" },
    },
    additionalProperties: false,
    examples: [
      {
        amount_in_cents: 5000000,
        currency: "COP",
        reference: "ref-card-001",
        customer_email: "cliente@ejemplo.com",
        payment_method: { type: "CARD" },
        acceptance_token: "sim_acceptance_abc123",
      },
    ],
  },
  response: {
    201: {
      description:
        "Transacción creada exitosamente. status siempre es PENDING al crear " +
        "(Wompi es asíncrono; la consulta GET posterior resuelve el estado final).",
      type: "object",
      properties: {
        data: wompiTransactionObject,
      },
      required: ["data"],
      examples: [
        {
          data: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            status: "PENDING",
            amount_in_cents: 5000000,
            currency: "COP",
            reference: "ref-card-001",
            customer_email: "cliente@ejemplo.com",
          },
        },
      ],
    },
    422: {
      description:
        "Cuerpo inválido. Ocurre cuando falta `payment_method` " +
        "(replica el 422 medido contra sandbox.wompi.co).",
      ...wompiErrorBody,
    },
    501: {
      description:
        "Escenario todavía no soportado. No es un error del servidor: " +
        "significa que el valor de x-simulate-scenario no está implementado.",
      type: "object",
      properties: {
        error: { type: "string" },
      },
    },
  },
} as const;

/**
 * GET /v1/sim/wompi/transactions/:id
 *
 * Consulta el estado de una transacción guardada. Para tarjeta resuelve
 * a APPROVED en la primera llamada; para PSE avanza en dos pasos.
 */
export const getWompiTransactionSchema = {
  summary: "Consultar transacción Wompi",
  description:
    "Simula `GET /transactions/:id` de Wompi. " +
    "Para cobros con tarjeta: la primera consulta resuelve PENDING → APPROVED " +
    "(comportamiento medido: Wompi lo resuelve en ~600 ms). " +
    "Para PSE: primera consulta → PENDING con `payment_method.extra.async_payment_url`; " +
    "segunda consulta → estado final según financial_institution_code " +
    "('1'=APPROVED, '2'=DECLINED, '3'=ERROR). " +
    "Devuelve 404 en forma nativa de Wompi si el id no existe.",
  tags: ["Wompi Simulación"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description: "Identificador UUID de la transacción",
        example: "550e8400-e29b-41d4-a716-446655440000",
      },
    },
  },
  response: {
    200: {
      description: "Transacción encontrada. La transacción está envuelta en `data`.",
      type: "object",
      properties: {
        data: wompiTransactionObject,
      },
      required: ["data"],
      examples: [
        {
          data: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            status: "APPROVED",
            amount_in_cents: 5000000,
            currency: "COP",
            reference: "ref-card-001",
            customer_email: "cliente@ejemplo.com",
          },
        },
      ],
    },
    404: {
      description: "Transacción no encontrada.",
      ...wompiErrorBody,
    },
  },
} as const;

/**
 * GET /v1/sim/wompi/merchants/:publicKey
 *
 * Devuelve un acceptance_token de un solo uso, requerido por Wompi antes
 * de crear cualquier transacción.
 */
export const getWompiMerchantSchema = {
  summary: "Obtener datos del comercio Wompi (acceptance_token)",
  description:
    "Simula `GET /merchants/:publicKey` de Wompi. " +
    "Devuelve un acceptance_token simulado (único por llamada) y " +
    "un permalink de términos. El SDK lo llama antes de crear cualquier transacción " +
    "porque Wompi exige ese token en cada POST.",
  tags: ["Wompi Simulación"],
  params: {
    type: "object",
    required: ["publicKey"],
    properties: {
      publicKey: {
        type: "string",
        description: "Llave pública del comercio",
        example: "pub_test_abc123",
      },
    },
  },
  response: {
    200: {
      description: "Datos del comercio con acceptance_token válido para una sola transacción.",
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: {
            presigned_acceptance: {
              type: "object",
              properties: {
                acceptance_token: {
                  type: "string",
                  description: "Token de aceptación de términos (único por llamada)",
                  example: "sim_acceptance_550e8400-e29b-41d4-a716-446655440000",
                },
                permalink: {
                  type: "string",
                  format: "uri",
                  description: "URL de los términos y condiciones de Wompi",
                  example: "http://localhost:3000/v1/sim/wompi/terms",
                },
              },
              required: ["acceptance_token", "permalink"],
            },
          },
          required: ["presigned_acceptance"],
        },
      },
      required: ["data"],
    },
  },
} as const;

/**
 * GET /v1/sim/wompi/pse/financial_institutions
 *
 * Lista las tres entidades de prueba de PSE. Los códigos controlan el desenlace.
 */
export const getWompiPseInstitutionsSchema = {
  summary: "Listar entidades financieras PSE Wompi",
  description:
    "Simula `GET /pse/financial_institutions` de Wompi. " +
    "Devuelve las tres entidades de prueba del sandbox " +
    "(medidas contra sandbox.wompi.co el 18 de septiembre de 2026): " +
    "código '1' aprueba, '2' declina, '3' simula error.",
  tags: ["Wompi Simulación"],
  response: {
    200: {
      description: "Lista de entidades financieras PSE disponibles.",
      type: "object",
      properties: {
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              financial_institution_code: {
                type: "string",
                description: "Código de la entidad (controla el desenlace de la simulación)",
              },
              financial_institution_name: { type: "string" },
            },
            required: ["financial_institution_code", "financial_institution_name"],
          },
        },
        meta: { type: "object", additionalProperties: true },
      },
      required: ["data", "meta"],
      examples: [
        {
          data: [
            { financial_institution_code: "1", financial_institution_name: "Banco que aprueba" },
            { financial_institution_code: "2", financial_institution_name: "Banco que declina" },
            { financial_institution_code: "3", financial_institution_name: "Banco que simula un error" },
          ],
          meta: {},
        },
      ],
    },
  },
} as const;

/**
 * POST /v1/sim/wompi/tokens/cards (issue #126)
 *
 * Tokenización de tarjeta de crédito en Wompi.
 */
export const postWompiTokenCardSchema = {
  summary: "Tokenizar tarjeta de crédito Wompi",
  description:
    "Simula `POST /v1/tokens/cards` de Wompi. " +
    "Requiere cabecera `Authorization: Bearer <pub_key>`.",
  tags: ["Wompi Simulación"],
  headers: {
    type: "object",
    required: ["authorization"],
    properties: {
      authorization: {
        type: "string",
        description: "Cabecera Bearer con la llave pública del comercio (pub_test_...)",
        example: "Bearer pub_test_abc123",
      },
      "x-simulate-scenario": simulateScenarioHeader,
    },
  },
  body: {
    type: "object",
    required: ["number", "cvc", "exp_month", "exp_year", "card_holder"],
    properties: {
      number: { type: "string", description: "Número de tarjeta", example: "4242424242424242" },
      cvc: { type: "string", description: "Código CVC", example: "123" },
      exp_month: { type: "string", description: "Mes de expiración (MM)", example: "12" },
      exp_year: { type: "string", description: "Año de expiración (AA o AAAA)", example: "30" },
      card_holder: { type: "string", description: "Nombre del tarjetahabiente", example: "Juan Pérez" },
    },
  },
  response: {
    201: {
      description: "Tarjeta tokenizada exitosamente.",
      type: "object",
      properties: {
        status: { type: "string", example: "CREATED" },
        data: {
          type: "object",
          properties: {
            id: { type: "string", example: "tok_sim_12345678" },
            created_at: { type: "string", format: "date-time" },
            brand: { type: "string", example: "VISA" },
            name: { type: "string", example: "Juan Pérez" },
            last_four: { type: "string", example: "4242" },
            bin: { type: "string", example: "424242" },
            exp_year: { type: "string", example: "30" },
            exp_month: { type: "string", example: "12" },
            card_holder: { type: "string", example: "Juan Pérez" },
            created_with_cvc: { type: "boolean", example: true },
            expires_at: { type: "string", format: "date-time" },
            validity_ends_at: { type: ["string", "null"] },
          },
        },
      },
    },
    401: {
      description: "No autorizado (Authorization header faltante).",
      ...wompiErrorBody,
    },
    404: {
      description: "Comercio no encontrado.",
      ...wompiErrorBody,
    },
    422: {
      description: "Error de validación de campos de entrada.",
      type: "object",
      properties: {
        error: {
          type: "object",
          properties: {
            type: { type: "string", example: "INPUT_VALIDATION_ERROR" },
            messages: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
          },
        },
      },
    },
  },
} as const;

