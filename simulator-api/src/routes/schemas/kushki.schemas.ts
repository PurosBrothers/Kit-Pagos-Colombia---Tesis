/**
 * Schemas OpenAPI/JSON-Schema para las rutas de simulación de Kushki (issue #107).
 *
 * Cada schema se define de forma desacoplada y se asocia a cada ruta en Fastify.
 * Fastify valida las peticiones entrantes sin recortar campos de respuesta (gracias a
 * `compileSchemasAsIs`) y expone la especificación OpenAPI 3.0 en /docs.
 *
 * Puntos de diseño y mediciones registradas en architecture-log.md:
 * - Kushki exige el monto descompuesto en un objeto `amount` (subtotalIva0, subtotalIva, iva, ice, currency).
 * - En cobros con tarjeta, el identificador es `ticketNumber` (18 caracteres) y el estado viaja dentro de `details`.
 * - Un rechazo con tarjeta en creación responde HTTP 400 con `KushkiDeclinedChargeError`.
 * - Kushki NO tiene ruta de consulta de estado para cobros con tarjeta en su API real;
 *   `GET /charges/:ticketNumber` simula el comportamiento medido: ante un token de 32 hex responde 403 Forbidden.
 * - El flujo PSE de Kushki (Transfer In) consta de 3 llamadas ordenadas:
 *   1. GET /transfer/v1/bankList
 *   2. POST /transfer/v1/tokens (obtiene token y registra callbackUrl)
 *   3. POST /transfer/v1/init (inicia y genera redirectUrl y trazabilityCode)
 *   Y luego GET /transfer/v1/status/:token para la consulta.
 * - Para transferencias no existe estado EXPIRED en Colombia (responde 501).
 * - Respuestas 501 son parte del contrato (escenario aún no soportado).
 */

const TAGS = ["Kushki Simulación"];

// ─── Componentes y fragmentos reutilizables ───

const kushkiAmountSchema = {
  type: "object",
  description: "Desglose de impuestos tal como lo exige el objeto amount de Kushki.",
  properties: {
    subtotalIva0: { type: "number", description: "Subtotal con tarifa IVA 0% (en pesos)" },
    subtotalIva: { type: "number", description: "Subtotal gravado con IVA" },
    iva: { type: "number", description: "Valor del IVA" },
    ice: { type: "number", description: "Valor del impuesto ICE" },
    currency: { type: "string", description: "Código de divisa ISO", example: "COP" },
  },
  required: ["subtotalIva0", "subtotalIva", "iva"],
} as const;

const simulateScenarioHeader = {
  type: "string",
  description:
    "Cabecera de control de simulación. Admite: APPROVAL, APPROVED, DECLINED, REJECTED, " +
    "INITIALIZED, PENDING, EXPIRED, FLAPPING, DUPLICATE_PAYMENT, y fallas técnicas " +
    "(GATEWAY_TIMEOUT, SERVER_ERROR, etc.). Cualquier escenario desconocido responde 501.",
  example: "APPROVAL",
} as const;

const kushkiChargeResponseSchema = {
  type: "object",
  properties: {
    ticketNumber: {
      type: "string",
      description: "Identificador del cobro en la pasarela.",
      example: "15c4fb1ba7f9417eac",
    },
    transactionReference: {
      type: "string",
      description: "Referencia interna generada por Kushki.",
      example: "7df4d70e-327e-4501-b215-1edc3f6424d4",
    },
    details: {
      type: "object",
      description: "Detalles del cobro y estado financiero.",
      properties: {
        transactionStatus: {
          type: "string",
          enum: ["APPROVAL", "DECLINED", "INITIALIZED"],
          description: "Estado de la transacción (APPROVAL para aprobadas).",
          example: "APPROVAL",
        },
        trackingCode: {
          type: "string",
          description: "Eco de la referencia del comercio si fue enviada.",
          example: "ORD-98765",
        },
        subtotalIva0: { type: "number", example: 50000 },
        subtotalIva: { type: "number", example: 0 },
        ivaValue: { type: "number", example: 0 },
        iceValue: { type: "number", example: 0 },
        currencyCode: { type: "string", example: "COP" },
        approvedTransactionAmount: { type: "number", example: 50000 },
        responseText: { type: "string", example: "Transacción aprobada" },
        contactDetails: {
          type: "object",
          properties: {
            email: { type: "string", example: "cliente@example.com" },
          },
        },
      },
      required: [
        "transactionStatus",
        "subtotalIva0",
        "subtotalIva",
        "ivaValue",
        "iceValue",
        "currencyCode",
        "approvedTransactionAmount",
        "responseText",
      ],
    },
  },
  required: ["ticketNumber", "transactionReference", "details"],
} as const;

// ─── 1. POST /v1/sim/kushki/card/v1/charges ───

export const postCardChargesSchema = {
  summary: "Crear cobro con tarjeta en Kushki",
  description:
    "Procesa un cobro con tarjeta usando un token emitido. Kushki exige el monto en un objeto amount " +
    "descompuesto en subtotalIva0, subtotalIva, iva, ice y currency. El identificador retornado es ticketNumber. " +
    "Un cobro aprobado responde 201 con transactionStatus APPROVAL. Si el banco rechaza la tarjeta, Kushki " +
    "responde HTTP 400 con código K001 o el detalle del rechazo en el cuerpo. Escenarios desconocidos responden 501.",
  tags: TAGS,
  headers: {
    type: "object",
    properties: {
      "private-merchant-id": {
        type: "string",
        description: "Llave privada de comercio de Kushki.",
      },
      "x-simulate-scenario": simulateScenarioHeader,
    },
  },
  body: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "Token de tarjeta generado por tokenización.",
        example: "a8d000d6ae394d069ea6d7b577484590",
      },
      trackingCode: {
        type: "string",
        description: "Referencia del pedido en el comercio.",
        example: "ORD-98765",
      },
      amount: kushkiAmountSchema,
      contactDetails: {
        type: "object",
        properties: {
          email: { type: "string", example: "cliente@example.com" },
          firstName: { type: "string", example: "Pedro" },
          lastName: { type: "string", example: "Perez" },
        },
      },
    },
    required: ["token", "amount"],
  },
  response: {
    201: {
      description: "Cobro creado exitosamente en Kushki.",
      ...kushkiChargeResponseSchema,
    },
    400: {
      description: "Cobro declinado por el banco o datos de petición inválidos.",
      type: "object",
      properties: {
        code: { type: "string", example: "K001" },
        message: { type: "string", example: "Cuerpo de la petición inválido." },
        details: { type: "object" },
        transactionReference: { type: "string" },
      },
    },
    409: {
      description: "Transacción duplicada (escenario DUPLICATE_PAYMENT).",
      type: "object",
      properties: {
        code: { type: "string", example: "K409" },
        message: { type: "string" },
      },
    },
    501: {
      description: "Escenario de simulación aún no soportado.",
      type: "object",
      properties: {
        error: { type: "string" },
      },
    },
    503: {
      description: "Falla de servicio o reintento de escenario FLAPPING.",
      type: "object",
    },
  },
} as const;

// ─── 2. GET /v1/sim/kushki/charges/:ticketNumber ───

export const getChargeByTicketNumberSchema = {
  summary: "Consultar cobro por ticketNumber en Kushki",
  description:
    "Consulta un cobro previamente registrado mediante su ticketNumber. NOTA ARQUITECTÓNICA: En la API real " +
    "de Kushki no existe ruta de consulta de estado para cobros con tarjeta (solo aplica a transferencias). " +
    "El simulador reproduce la medición: si se consulta un identificador de 32 hex (de transferencia), responde 403 Forbidden. " +
    "Para identificadores de cobro con tarjeta válidos existentes responde 200 con su estado.",
  tags: TAGS,
  params: {
    type: "object",
    properties: {
      ticketNumber: {
        type: "string",
        description: "Identificador del cobro generado por Kushki.",
        example: "15c4fb1ba7f9417eac",
      },
    },
    required: ["ticketNumber"],
  },
  response: {
    200: {
      description: "Detalle del cobro encontrado.",
      ...kushkiChargeResponseSchema,
    },
    403: {
      description: "Forbidden (medido contra la pasarela al consultar identificador de transferencia aquí).",
      type: "object",
      properties: {
        message: { type: "string", example: "Forbidden" },
      },
    },
    404: {
      description: "Transacción no encontrada en el simulador.",
      type: "object",
      properties: {
        code: { type: "string", example: "K404" },
        message: { type: "string", example: "Transacción no encontrada" },
      },
    },
  },
} as const;

// ─── 3. GET /v1/sim/kushki/transfer/v1/bankList ───

export const getBankListSchema = {
  summary: "Listar bancos para transferencia PSE en Kushki",
  description:
    "Paso 1 del flujo de Transfer In (PSE) en Colombia: obtiene la lista oficial de instituciones financieras. " +
    "Es un paso obligatorio en Colombia porque el bankId requerido en el paso 2 debe seleccionarse de esta lista.",
  tags: TAGS,
  headers: {
    type: "object",
    properties: {
      "public-merchant-id": {
        type: "string",
        description: "Llave pública de comercio de Kushki.",
      },
    },
  },
  response: {
    200: {
      description: "Lista de entidades bancarias PSE.",
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string", description: "Código de la entidad bancaria", example: "001" },
          name: { type: "string", description: "Nombre de la entidad bancaria", example: "Bancolombia" },
        },
        required: ["code", "name"],
      },
    },
    403: {
      description: "Credenciales de transferencia no autorizadas.",
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

// ─── 4. POST /v1/sim/kushki/transfer/v1/tokens ───

export const postTransferTokensSchema = {
  summary: "Obtener token de transferencia PSE en Kushki",
  description:
    "Paso 2 del flujo de Transfer In (PSE): solicita un token de transferencia de 32 hex. En este paso el " +
    "comercio envía la callbackUrl (URL de retorno). El escenario de simulación (aprobado o rechazado) " +
    "queda registrado en este paso para determinar el desenlace final. NOTA: Para Colombia no existe el " +
    "estado EXPIRED (responde 501).",
  tags: TAGS,
  headers: {
    type: "object",
    properties: {
      "public-merchant-id": {
        type: "string",
        description: "Llave pública de comercio de Kushki.",
      },
      "x-simulate-scenario": simulateScenarioHeader,
    },
  },
  body: {
    type: "object",
    properties: {
      bankId: {
        type: "string",
        description: "Código de banco obtenido de bankList.",
        example: "001",
      },
      callbackUrl: {
        type: "string",
        format: "uri",
        description: "URL a la que el banco redirigirá al pagador una vez completada la autorización.",
        example: "https://comercio.example.com/checkout/return",
      },
      userType: { type: "string", example: "0" },
      documentType: { type: "string", example: "CC" },
      documentNumber: { type: "string", example: "1999888777" },
      email: { type: "string", format: "email", example: "cliente@example.com" },
      currency: { type: "string", example: "COP" },
      paymentDescription: { type: "string", example: "Pago de orden #1234" },
      amount: kushkiAmountSchema,
    },
    required: ["bankId", "callbackUrl"],
  },
  response: {
    201: {
      description: "Token de transferencia generado exitosamente.",
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token de 32 caracteres hexadecimales de la transferencia.",
          example: "a8d000d6ae394d069ea6d7b577484590",
        },
      },
      required: ["token"],
    },
    400: {
      description: "Parámetros obligatorios faltantes.",
      type: "object",
      properties: {
        code: { type: "string", example: "T001" },
        message: { type: "string", example: "bankId es obligatorio" },
      },
    },
    403: {
      description: "Credenciales inválidas.",
      type: "object",
    },
    501: {
      description: "Escenario de simulación no soportado (p. ej. EXPIRED en Colombia).",
      type: "object",
      properties: {
        error: { type: "string" },
      },
    },
    503: {
      description: "Falla de servidor o flapping.",
      type: "object",
    },
  },
} as const;

// ─── 5. POST /v1/sim/kushki/transfer/v1/init ───

export const postTransferInitSchema = {
  summary: "Iniciar transferencia PSE en Kushki",
  description:
    "Paso 3 del flujo de Transfer In (PSE): inicia la transferencia con el token emitido y genera la redirectUrl " +
    "del portal bancario y el código de trazabilidad (trazabilityCode). Kushki exige repetir el monto en esta llamada.",
  tags: TAGS,
  headers: {
    type: "object",
    properties: {
      "private-merchant-id": {
        type: "string",
        description: "Llave privada de comercio de Kushki.",
      },
      "x-simulate-scenario": simulateScenarioHeader,
    },
  },
  body: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "Token de 32 caracteres obtenido en el paso 2.",
        example: "a8d000d6ae394d069ea6d7b577484590",
      },
      amount: kushkiAmountSchema,
    },
    required: ["token", "amount"],
  },
  response: {
    201: {
      description: "Transferencia iniciada exitosamente.",
      type: "object",
      properties: {
        bankId: { type: "string", example: "001" },
        bankName: { type: "string", example: "Bancolombia" },
        redirectUrl: {
          type: "string",
          format: "uri",
          description: "URL a la que debe redirigirse al pagador.",
          example: "http://localhost:3000/v1/sim/kushki/transfer/v1/agent?token=a8d000d6ae394d069ea6d7b577484590",
        },
        transactionReference: { type: "string", example: "5b70cbed-1350-4d5b-b7dc-c9ee6832c626" },
        trazabilityCode: { type: "string", example: "151428904" },
      },
      required: ["bankId", "bankName", "redirectUrl", "transactionReference", "trazabilityCode"],
    },
    400: {
      description: "Cuerpo inválido o transacción inexistente.",
      type: "object",
      properties: {
        code: { type: "string", example: "T001" },
        message: { type: "string", example: "Cuerpo de la petición inválido." },
      },
    },
    403: {
      description: "Credenciales inválidas.",
      type: "object",
    },
    501: {
      description: "Escenario de simulación no soportado.",
      type: "object",
      properties: {
        error: { type: "string" },
      },
    },
  },
} as const;

// ─── 6. GET /v1/sim/kushki/transfer/v1/status/:token ───

export const getTransferStatusSchema = {
  summary: "Consultar estado de transferencia PSE en Kushki",
  description:
    "Consulta el estado de una transferencia PSE mediante su token de 32 hex. En este paso el simulador evalúa " +
    "la máquina de estados transitando de 'initializedTransaction' a su desenlace ('approvedTransaction' o 'declinedTransaction'). " +
    "Si se consulta un token con longitud diferente de 32 caracteres (p. ej. un ticket de tarjeta de 18 caracteres), " +
    "responde 400 T001 reproduciendo la medición contra la API real.",
  tags: TAGS,
  headers: {
    type: "object",
    properties: {
      "private-merchant-id": {
        type: "string",
        description: "Llave privada de comercio de Kushki.",
      },
    },
  },
  params: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "Token de 32 caracteres de la transferencia.",
        example: "a8d000d6ae394d069ea6d7b577484590",
      },
    },
    required: ["token"],
  },
  response: {
    200: {
      description: "Estado actual de la transferencia.",
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [
            "requestedToken",
            "initializedTransaction",
            "approvedTransaction",
            "declinedTransaction",
          ],
          description: "Estado de la transferencia en Kushki.",
          example: "approvedTransaction",
        },
        token: { type: "string", example: "a8d000d6ae394d069ea6d7b577484590" },
        paymentDescription: { type: "string", example: "ORDER-SIM-PSE" },
        email: { type: "string", format: "email", example: "cliente@example.com" },
        amount: kushkiAmountSchema,
        transactionReference: { type: "string", example: "2bd33ca1-f269-4d3b-9c5d-1c23e7800c84" },
        bankId: { type: "string", example: "001" },
        documentType: { type: "string", example: "CC" },
        documentNumber: { type: "string", example: "1999888777" },
        currency: { type: "string", example: "COP" },
        country: { type: "string", example: "Colombia" },
        created: { type: "number", example: 1793487607993 },
        merchantName: { type: "string", example: "KIT PAGOS COLOMBIA" },
        callbackUrl: { type: "string", format: "uri", example: "https://comercio.example.com/checkout/return" },
      },
      required: [
        "status",
        "token",
        "paymentDescription",
        "email",
        "amount",
        "transactionReference",
        "bankId",
        "currency",
        "country",
        "created",
      ],
    },
    400: {
      description: "Token inválido (T001) o no encontrado (T004).",
      type: "object",
      properties: {
        code: { type: "string", example: "T001" },
        message: { type: "string", example: "Cuerpo de la petición inválido." },
      },
    },
    403: {
      description: "Credenciales inválidas.",
      type: "object",
    },
  },
} as const;
