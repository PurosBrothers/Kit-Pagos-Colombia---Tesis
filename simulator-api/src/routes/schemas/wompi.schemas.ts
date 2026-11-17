/**
 * Schemas OpenAPI/JSON-Schema para las rutas de simulación de Wompi.
 *
 * Cada schema se define una sola vez aquí y se reutiliza en el router.
 * De esta manera Fastify valida las peticiones entrantes, genera la
 * documentación en /docs, y el comportamiento de los handlers no cambia.
 *
 * Notas de diseño derivadas del architecture-log.md y del código medido:
 *
 * - En creación, `x-simulate-scenario` admite los escenarios de negocio del
 *   ScenarioEngine y los técnicos de technicalFailure.ts. Un valor desconocido
 *   devuelve 501. En tokenización solo se aplican fallas técnicas.
 *
 * - El POST devuelve 201 con status PENDING, no APPROVED (punto 50 del
 *   architecture-log.md; un cobro con tarjeta de Wompi es asíncrono).
 *
 * - PSE: la creación devuelve PENDING sin async_payment_url; la primera consulta
 *   GET publica la URL y la siguiente resuelve el estado (punto 43).
 *
 * - El 501 es parte del contrato: escenario todavía no soportado.
 */

// ─── Fragmentos reutilizables ────────────────────────────────────────────────

/** Cabecera de control de escenario, compartida por todas las rutas. */
const simulateScenarioHeader = {
  type: "string",
  description:
    "Escenario de simulación. En creación de transacciones se admiten APPROVED, APPROVAL, " +
    "PENDING, PENDING_THEN_DECLINED, DECLINED, REJECTED, EXPIRED, TIMEOUT, " +
    "GATEWAY_TIMEOUT, NETWORK_ERROR, CONNECTION_ERROR, RATE_LIMIT, TOO_MANY_REQUESTS, " +
    "SERVER_ERROR, INTERNAL_ERROR, BAD_GATEWAY, SERVICE_UNAVAILABLE, FLAPPING, " +
    "DUPLICATE_PAYMENT, SLOW, MALFORMED_JSON, MALFORMED_BODY, HTML_ERROR, 429, 500, " +
    "502, 503 e INVALID_CREDENTIALS. " +
    "Un escenario de creación desconocido devuelve 501. Sin la cabecera deciden la tarjeta " +
    "de prueba (4111 1111 1111 1111 termina DECLINED) y los montos reservados de 10 001 a " +
    "10 604 pesos; si ninguno pide un escenario, APPROVED. En tokenización solo se " +
    "aplican escenarios técnicos.",
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
        messages: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } },
        },
      },
      required: ["type"],
    },
  },
} as const;

/**
 * Las fallas técnicas de `technicalFailure.ts` en la creación, con el cuerpo de
 * `WompiErrorMockFactory`. Nivel 3, convención del simulador.
 */
const creationFailureResponses = {
  200: {
    description:
      "MALFORMED_JSON (un cuerpo que no es JSON) o MALFORMED_BODY (`{ data: {} }`, sin los " +
      "campos de la transacción). Prueban el normalizador del SDK.",
  },
  429: { description: "RATE_LIMIT, TOO_MANY_REQUESTS o 429.", ...wompiErrorBody },
  500: {
    description: "SERVER_ERROR, INTERNAL_ERROR o 500. NETWORK_ERROR corta la conexión sin responder.",
    ...wompiErrorBody,
  },
  502: {
    description: "BAD_GATEWAY o 502. HTML_ERROR también responde 502, con una página HTML y no JSON.",
    ...wompiErrorBody,
  },
  503: { description: "SERVICE_UNAVAILABLE o 503, y las dos primeras peticiones de FLAPPING.", ...wompiErrorBody },
  504: { description: "TIMEOUT o GATEWAY_TIMEOUT, y SLOW después de su espera.", ...wompiErrorBody },
} as const;

/** Las fallas de consulta que deja pedidas el monto de la creación (issue #122). */
const queryFailureResponses = {
  500: { description: "La creación fue por 10 600 pesos (QUERY_SERVER_ERROR).", ...wompiErrorBody },
  503: {
    description: "La creación fue por 10 602 pesos (QUERY_FLAPPING): fallan dos consultas y la tercera responde.",
    ...wompiErrorBody,
  },
  504: { description: "La creación fue por 10 604 pesos (QUERY_SLOW), después de la espera de SLOW.", ...wompiErrorBody },
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
        "desde la primera consulta GET; la creación no la trae (flujo de dos pasos).",
      properties: {
        type: { type: "string", example: "PSE" },
        token: {
          type: "string",
          description: "Token devuelto por POST /v1/sim/wompi/tokens/cards para pagos con tarjeta.",
          example: "tok_sim_12345678",
        },
        installments: { type: "integer", description: "Cuotas de un cobro con tarjeta.", example: 1 },
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
            "Datos adicionales. async_payment_url aparece a partir de la primera " +
            "consulta GET de un PSE, no en la creación (architecture-log punto 43).",
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
    "Cuando la creación tiene éxito devuelve 201 con `status: PENDING`, igual que la pasarela " +
    "real (architecture-log punto 50). Requiere acceptance_token de un solo uso y una firma " +
    "de integridad válida; faltas y firmas inválidas responden 422. " +
    "Para PSE la respuesta también es PENDING y sin URL de redirección: " +
    "la URL aparece en la primera consulta GET subsiguiente (architecture-log punto 43). " +
    "El header `x-simulate-scenario` controla el escenario; sin él deciden la tarjeta de " +
    "prueba y el monto.",
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
    required: [
      "amount_in_cents",
      "currency",
      "reference",
      "customer_email",
      "payment_method",
      "acceptance_token",
      "signature",
    ],
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
          "Requerido por el simulador; si se omite, responde 422. Para PSE, declara type=PSE " +
          "y los datos del banco; para tarjeta, declara type=CARD y el token.",
        properties: {
          type: { type: "string", example: "PSE" },
          token: {
            type: "string",
            description: "Token de POST /v1/sim/wompi/tokens/cards, en un cobro con tarjeta.",
            example: "tok_sim_809b112742b44621",
          },
          installments: { type: "integer", description: "Cuotas de un cobro con tarjeta.", example: 1 },
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
      acceptance_token: {
        type: "string",
        description: "Token de aceptación de términos Wompi requerido por el handler y de un solo uso.",
      },
      signature: {
        type: "string",
        description: "Firma SHA-256 de integridad requerida y validada por el simulador.",
      },
    },
    examples: [
      {
        amount_in_cents: 6800000,
        currency: "COP",
        reference: "orden-1042",
        customer_email: "comprador@example.com",
        payment_method: { type: "CARD", token: "tok_sim_809b112742b44621", installments: 1 },
        acceptance_token: "sim_acceptance_5ae098eb-cf10-4808-a4a8-15a82f65d96a",
        signature: "6fb6e613acbb2c8fd322121bf8738eb3013c8326db0b084c7681619711946c2b",
        redirect_url: "http://localhost:4001/orden/1042",
      },
    ],
  },
  response: {
    ...creationFailureResponses,
    201: {
      description:
        "Transacción creada exitosamente. status siempre es PENDING al crear " +
        "(Wompi es asíncrono; la consulta GET posterior resuelve el estado final). " +
        "Ejemplos: tarjeta, y PSE sin URL del banco.",
      type: "object",
      properties: {
        data: wompiTransactionObject,
      },
      required: ["data"],
      examples: [
        {
          data: {
            id: "bf0dc67c-a8bb-43f5-b4da-e4553a522505",
            status: "PENDING",
            amount_in_cents: 6800000,
            currency: "COP",
            reference: "orden-1042",
            customer_email: "comprador@example.com",
            payment_method: { type: "CARD", token: "tok_sim_809b112742b44621", installments: 1 },
          },
        },
        {
          data: {
            id: "72c61198-6bda-4087-9cd9-c00a3410f6dc",
            status: "PENDING",
            amount_in_cents: 6800000,
            currency: "COP",
            reference: "orden-1043",
            customer_email: "comprador@example.com",
            payment_method: {
              type: "PSE",
              user_type: 0,
              user_legal_id_type: "CC",
              user_legal_id: "1999888777",
              financial_institution_code: "1",
              payment_description: "Pedido 1043",
              extra: { is_three_ds: false, three_ds_auth_type: null },
            },
            redirect_url: "http://localhost:4001/orden/1043",
          },
        },
      ],
    },
    401: {
      description:
        "Llave inválida: INVALID_CREDENTIALS, o sin cabecera una llave que contiene `invalid`, " +
        "`inexistente` o `not_found`.",
      ...wompiErrorBody,
    },
    409: {
      description: "DUPLICATE_PAYMENT: la segunda transacción con la misma referencia.",
      ...wompiErrorBody,
    },
    422: {
      description:
        "Validación de Wompi: falta payment_method, acceptance_token o signature; " +
        "el token ya se usó o la firma de integridad es inválida.",
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
    "Devuelve 404 en forma nativa de Wompi si el id no existe. Las fallas de consulta que " +
    "pide el monto de la creación no se aplican a la consulta que publica la URL de un PSE: " +
    "esa la hace el SDK dentro de la creación.",
  tags: ["Wompi Simulación"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description: "Identificador UUID de la transacción",
        example: "bf0dc67c-a8bb-43f5-b4da-e4553a522505",
      },
    },
  },
  response: {
    200: {
      description:
        "Transacción encontrada. La transacción está envuelta en `data`. Ejemplos: tarjeta " +
        "resuelta, y las dos consultas de un PSE con el banco '1'.",
      type: "object",
      properties: {
        data: wompiTransactionObject,
      },
      required: ["data"],
      examples: [
        {
          data: {
            id: "bf0dc67c-a8bb-43f5-b4da-e4553a522505",
            status: "APPROVED",
            amount_in_cents: 6800000,
            currency: "COP",
            reference: "orden-1042",
            customer_email: "comprador@example.com",
            payment_method: { type: "CARD", token: "tok_sim_809b112742b44621", installments: 1 },
          },
        },
        {
          data: {
            id: "72c61198-6bda-4087-9cd9-c00a3410f6dc",
            status: "PENDING",
            amount_in_cents: 6800000,
            currency: "COP",
            reference: "orden-1043",
            customer_email: "comprador@example.com",
            payment_method: {
              type: "PSE",
              user_type: 0,
              user_legal_id_type: "CC",
              user_legal_id: "1999888777",
              financial_institution_code: "1",
              payment_description: "Pedido 1043",
              extra: {
                is_three_ds: false,
                three_ds_auth_type: null,
                async_payment_url:
                  "http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=72c611986bda40879cd9c00a3410f6dc",
              },
            },
            redirect_url: "http://localhost:4001/orden/1043",
          },
        },
        {
          data: {
            id: "72c61198-6bda-4087-9cd9-c00a3410f6dc",
            status: "APPROVED",
            amount_in_cents: 6800000,
            currency: "COP",
            reference: "orden-1043",
            customer_email: "comprador@example.com",
            payment_method: {
              type: "PSE",
              user_type: 0,
              user_legal_id_type: "CC",
              user_legal_id: "1999888777",
              financial_institution_code: "1",
              payment_description: "Pedido 1043",
              extra: {
                is_three_ds: false,
                three_ds_auth_type: null,
                async_payment_url:
                  "http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=72c611986bda40879cd9c00a3410f6dc",
              },
            },
            redirect_url: "http://localhost:4001/orden/1043",
          },
        },
      ],
    },
    403: {
      description:
        "Llave privada inválida: INVALID_CREDENTIALS, o sin cabecera una llave `prv_` que " +
        "contiene `invalid`, `inexistente` o `not_found`.",
      ...wompiErrorBody,
    },
    404: {
      description: "Transacción no encontrada.",
      ...wompiErrorBody,
    },
    ...queryFailureResponses,
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
    404: {
      description:
        "Comercio inexistente: INVALID_CREDENTIALS, o sin cabecera una llave que contiene " +
        "`invalid`, `inexistente` o `not_found`.",
      ...wompiErrorBody,
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
    500: { description: "La credencial contiene `sim_server_error` (issue #122).", ...wompiErrorBody },
    503: {
      description: "La credencial contiene `sim_flapping`: fallan dos peticiones y la tercera responde.",
      ...wompiErrorBody,
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
    "Requiere Authorization: Bearer <llave pública>. El handler responde 401 si falta la " +
    "cabecera, 404 si el comercio no existe y 422 si los datos no pasan las validaciones. " +
    "Use el `data.id` devuelto como `payment_method.token` al crear una transacción. " +
    "Las respuestas POST, incluidos los errores, permiten CORS desde cualquier origen.",
  tags: ["Wompi Simulación"],
  headers: {
    type: "object",
    required: ["authorization"],
    properties: {
      authorization: {
        type: "string",
        description: "Authorization: Bearer <llave pública del comercio>.",
        example: "Bearer pub_test_abc123",
      },
      "x-simulate-scenario": simulateScenarioHeader,
      "x-simulator-scenario": {
        ...simulateScenarioHeader,
        description: "Alias de x-simulate-scenario.",
      },
    },
  },
  body: {
    type: "object",
    properties: {
      number: {
        type: "string",
        description: "Número de tarjeta de 12 a 19 dígitos que pasa Luhn.",
        example: "4242424242424242",
      },
      cvc: { type: "string", description: "Código CVC de 3 o 4 dígitos", example: "123" },
      exp_month: { type: "string", description: "Mes de expiración (MM)", example: "12" },
      exp_year: { type: "string", description: "Año de expiración (AA o AAAA)", example: "30" },
      card_holder: { type: "string", description: "Nombre del tarjetahabiente", example: "Juan Perez" },
    },
    description:
      "El handler requiere number, cvc, exp_month, exp_year y card_holder; faltas o " +
      "valores inválidos responden 422 en el formato de validación nativo de Wompi.",
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
            name: { type: "string", example: "Juan Perez" },
            last_four: { type: "string", example: "4242" },
            bin: { type: "string", example: "424242" },
            exp_year: { type: "string", example: "30" },
            exp_month: { type: "string", example: "12" },
            card_holder: { type: "string", example: "Juan Perez" },
            created_with_cvc: { type: "boolean", example: true },
            expires_at: { type: "string", format: "date-time" },
            validity_ends_at: { type: ["string", "null"] },
          },
        },
      },
    },
    401: { description: "No autorizado: falta Authorization.", ...wompiErrorBody },
    404: { description: "Comercio no encontrado.", ...wompiErrorBody },
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
    429: { description: "Límite de solicitudes simulado.", ...wompiErrorBody },
    500: { description: "Error interno simulado.", ...wompiErrorBody },
    502: { description: "Error de gateway simulado.", ...wompiErrorBody },
    503: { description: "Servicio no disponible simulado.", ...wompiErrorBody },
    504: { description: "Tiempo de espera agotado simulado.", ...wompiErrorBody },
  },
} as const;
