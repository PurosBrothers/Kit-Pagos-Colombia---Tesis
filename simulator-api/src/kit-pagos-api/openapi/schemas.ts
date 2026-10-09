/**
 * Schemas JSON Schema / OpenAPI 3.0 para los endpoints de Kit Pagos.
 *
 * Son la fuente única de verdad para validación y documentación: Fastify los
 * usa para rechazar peticiones inválidas antes de que lleguen al handler, y
 * @fastify/swagger los convierte en la especificación OpenAPI que sirve /docs.
 *
 * Convención de nombres: cada schema es un objeto `const` exportado que se
 * pasa directamente a la propiedad `schema` de la ruta de Fastify.
 */

// ---------------------------------------------------------------------------
// Componentes reutilizables
// ---------------------------------------------------------------------------

/** Advertencia de credenciales del servidor usada en sandbox. */
const WarningSchema = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string", example: "SERVER_SANDBOX_CREDENTIALS_USED" },
    message: { type: "string", example: "x-gateway-private-key header missing; using server sandbox credentials" },
  },
} as const;

/** Cuerpo de error estándar del SDK. */
export const KitPagosErrorSchema = {
  type: "object",
  required: ["code", "message"],
  additionalProperties: true,
  properties: {
    code: {
      type: "string",
      description:
        "Código de error del SDK. Uno de: INVALID_REQUEST, UNSUPPORTED_OPERATION, " +
        "INVALID_CREDENTIALS, WEBHOOK_SIGNATURE_INVALID, RESOURCE_NOT_FOUND, " +
        "RATE_LIMIT_EXCEEDED, CONNECTION_FAILED, GATEWAY_SERVER_ERROR, " +
        "MALFORMED_RESPONSE, MAX_RETRIES_EXCEEDED, GATEWAY_TIMEOUT, UNKNOWN_ERROR.",
      example: "INVALID_REQUEST",
    },
    message: { type: "string", description: "Descripción legible del error.", example: "Missing required fields: orderReference" },
    warnings: {
      type: "array",
      description: "Advertencias cuando se usaron credenciales del servidor en un sandbox real.",
      items: WarningSchema,
    },
  },
} as const;

/** Error de autenticación (401 de la API REST o del SDK). */
export const UnauthorizedSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    error: { type: "string", example: "Unauthorized" },
    code: {
      type: "string",
      description: "Código de error del SDK cuando el fallo es de credenciales (INVALID_CREDENTIALS o WEBHOOK_SIGNATURE_INVALID).",
      example: "INVALID_CREDENTIALS",
    },
    message: { type: "string", example: "Missing or invalid Authorization header" },
    warnings: {
      type: "array",
      description: "Advertencias cuando se usaron credenciales del servidor en un sandbox real.",
      items: WarningSchema,
    },
  },
} as const;

/** Cabeceras de credenciales de pasarela (opcionales en todas las rutas). */
export const GatewayCredentialHeaders = {
  "x-gateway-public-key": {
    type: "string",
    description: "Clave pública de la pasarela. Si se omite, se usan las del servidor (solo permitido en simulador o sandbox).",
  },
  "x-gateway-private-key": {
    type: "string",
    description: "Clave privada de la pasarela.",
  },
  "x-gateway-integrity-secret": {
    type: "string",
    description: "Secreto de integridad (solo Wompi).",
  },
  "x-gateway-webhook-secret": {
    type: "string",
    description: "Secreto de firma de webhooks.",
  },
} as const;

// ---------------------------------------------------------------------------
// GET /v1/api/gateways
// ---------------------------------------------------------------------------

export const GetGatewaysSchema = {
  tags: ["Kit Pagos"],
  summary: "Pasarelas disponibles",
  description: "Devuelve la lista de pasarelas que el SDK soporta. No requiere credenciales.",
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: "Lista de identificadores de pasarela en minúsculas.",
      type: "object",
      required: ["gateways"],
      properties: {
        gateways: {
          type: "array",
          items: { type: "string" },
          example: ["wompi", "mercadopago", "kushki", "rapyd"],
        },
      },
    },
    401: { description: "Token Bearer ausente o inválido.", ...UnauthorizedSchema },
  },
} as const;

// ---------------------------------------------------------------------------
// POST /v1/api/payments
// ---------------------------------------------------------------------------

const PayerSchema = {
  type: "object",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email", example: "pagador@ejemplo.com" },
    fullName: { type: "string", example: "Juan Pérez" },
    firstName: { type: "string", example: "Juan" },
    lastName: { type: "string", example: "Pérez" },
    documentType: { type: "string", example: "CC" },
    documentNumber: { type: "string", example: "1020304050" },
    phone: { type: "string", example: "3001234567" },
    phoneAreaCode: { type: "string", example: "57" },
    address: {
      type: "object",
      required: ["streetName", "streetNumber", "city", "zipCode", "neighborhood"],
      properties: {
        streetName: { type: "string", example: "Cra 7" },
        streetNumber: { type: "string", example: "1-1" },
        city: { type: "string", example: "Bogotá" },
        zipCode: { type: "string", example: "110111" },
        neighborhood: { type: "string", example: "Centro" },
      },
    },
  },
} as const;

const PaymentMethodSchema = {
  description: "Método de pago. CARD requiere token; PSE requiere bankCode.",
  properties: {
    type: {
      type: "string",
      description: "Método de pago (CARD, PSE, etc.).",
      example: "CARD",
    },
    token: {
      type: "string",
      description: "Token de tarjeta emitido por la pasarela (CARD). Wompi: tok_staging_…; Mercado Pago: cadena hex; Kushki: token alfanumérico.",
      example: "tok_staging_abc123",
    },
    cardToken: { type: "string", description: "Alias de token, aceptado por compatibilidad." },
    bankCode: {
      type: "string",
      description: "Código de banco PSE. Puede ser un PseBankCode (p. ej. '1007' para Bancolombia) o el code de getPseBanks().",
      example: "1007",
    },
    payerKind: {
      type: "string",
      description: "Naturaleza jurídica del pagador (solo PSE): NATURAL o LEGAL.",
      example: "NATURAL",
    },
    installments: {
      description: "Número de cuotas (solo CARD). Mercado Pago lo exige; Wompi y Kushki lo aceptan.",
      example: 1,
    },
  },
} as const;

const TaxBreakdownSchema = {
  description:
    "Desglose tributario opcional. Puede usar 'rate' (tasa IVA incluida en el monto, p. ej. '0.19') " +
    "o los componentes explícitos subtotalIva0 + subtotalIva + iva (+ ice opcional). " +
    "Si viene con campos que no se pueden interpretar, la petición responde 400.",
  properties: {
    rate: { example: "0.19", description: "Tasa de IVA. El SDK calcula los componentes a partir del monto total." },
    subtotalIva0: { example: "0.00" },
    subtotalIva: { example: "63025.21" },
    iva: { example: "11974.79" },
    ice: { example: "0.00" },
  },
} as const;

const ReturnUrlConfigSchema = {
  type: "object",
  description: "URLs de retorno después de la redirección PSE o 3DS.",
  properties: {
    returnUrl: { type: "string", format: "uri", example: "https://mitienda.com/retorno" },
    returnUrls: {
      type: "object",
      properties: {
        success: { type: "string", format: "uri" },
        failure: { type: "string", format: "uri" },
        pending: { type: "string", format: "uri" },
      },
    },
  },
} as const;

const TRANSACTION_STATUS_ENUM = [
  "APPROVED",
  "DECLINED",
  "PENDING",
  "EXPIRED",
  "VOIDED",
  "ERROR",
  "REFUNDED",
  "CANCELLED",
  "UNKNOWN",
] as const;

/** Respuesta cuando el cobro se completó en línea (tarjeta aprobada). */
const TransactionOutcomeSchema = {
  type: "object",
  required: ["outcome", "transaction"],
  additionalProperties: true,
  properties: {
    outcome: { type: "string", enum: ["TRANSACTION"] },
    rawStatus: { type: "string", description: "Estado tal como lo devolvió la pasarela." },
    transaction: {
      type: "object",
      required: ["gatewayTransactionId", "orderReference", "amount", "currency", "status", "isApproved", "isPending", "isFinal"],
      additionalProperties: true,
      properties: {
        gatewayTransactionId: { type: "string", example: "12345-67890" },
        orderReference: { type: "string", example: "ORD-001" },
        amount: { type: "string", example: "50000.00" },
        currency: { type: "string", example: "COP" },
        payer: PayerSchema,
        status: {
          type: "string",
          enum: TRANSACTION_STATUS_ENUM,
        },
        rawStatus: { type: "string", description: "Estado tal como lo devolvió la pasarela." },
        isApproved: { type: "boolean" },
        isPending: { type: "boolean" },
        isFinal: { type: "boolean" },
        authorizationCode: { type: "string" },
        rejectionReason: {
          type: "object",
          properties: {
            code: { type: "string" },
            category: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
    warnings: {
      type: "array",
      description: "Advertencias cuando se usaron credenciales del servidor en un sandbox real.",
      items: WarningSchema,
    },
  },
} as const;

/** Respuesta cuando el cobro exige redirección (PSE, 3DS, Rapyd). */
const RedirectOutcomeSchema = {
  type: "object",
  required: ["outcome", "redirect"],
  additionalProperties: true,
  properties: {
    outcome: { type: "string", enum: ["REDIRECT_REQUIRED"] },
    redirect: {
      type: "object",
      required: ["redirectUrl", "gatewayTransactionId"],
      additionalProperties: true,
      properties: {
        redirectUrl: {
          type: "string",
          format: "uri",
          description: "URL a la que el pagador debe ser redirigido para completar el pago.",
          example: "https://checkout.wompi.co/p/?id=abc123",
        },
        gatewayTransactionId: { type: "string" },
        rawStatus: { type: "string" },
      },
    },
    warnings: { type: "array", items: WarningSchema },
  },
} as const;

export const PostPaymentsSchema = {
  tags: ["Kit Pagos"],
  summary: "Crear un cobro",
  description:
    "Crea un cobro a través del SDK contra la pasarela indicada. " +
    "La respuesta discrimina entre `TRANSACTION` (cobro completado en línea) y " +
    "`REDIRECT_REQUIRED` (PSE, 3DS o Rapyd: el pagador debe ser redirigido). " +
    "Ambos casos responden HTTP 201.",
  security: [{ bearerAuth: [] }],
  headers: {
    type: "object",
    properties: GatewayCredentialHeaders,
  },
  body: {
    type: "object",
    required: ["amount", "currency", "orderReference", "payer"],
    properties: {
      gateway: {
        type: "string",
        description: "Pasarela por la que se procesa el cobro: wompi, mercadopago, kushki o rapyd.",
        example: "wompi",
      },
      amount: {
        type: "string",
        pattern: "^\\d+(\\.\\d+)?$",
        description: "Monto con decimales exactos como cadena. Ejemplo: '50000.00'.",
        example: "50000.00",
      },
      currency: { type: "string", example: "COP" },
      orderReference: {
        type: "string",
        maxLength: 100,
        description: "Referencia única del pedido en el sistema del comercio.",
        example: "ORD-2024-001",
      },
      payer: PayerSchema,
      paymentMethod: PaymentMethodSchema,
      returnUrlConfig: ReturnUrlConfigSchema,
      taxBreakdown: TaxBreakdownSchema,
      ipAddress: { type: "string", example: "186.84.90.1" },
    },
  },
  response: {
    201: {
      description:
        "Cobro procesado. El campo `outcome` discrimina el tipo de respuesta: " +
        "`TRANSACTION` si el cobro se completó, `REDIRECT_REQUIRED` si el pagador debe ser redirigido.",
      oneOf: [TransactionOutcomeSchema, RedirectOutcomeSchema],
    },
    400: {
      description: "Petición inválida (campo faltante, valor fuera de rango o pasarela no soportada).",
      ...KitPagosErrorSchema,
    },
    401: {
      description: "Token Bearer ausente o credenciales de pasarela insuficientes.",
      type: "object",
      additionalProperties: true,
      properties: {
        error: { type: "string", example: "Unauthorized" },
        code: { type: "string", example: "INVALID_CREDENTIALS" },
        message: { type: "string", example: "Missing or invalid Authorization header" },
        warnings: {
          type: "array",
          description: "Advertencias cuando se usaron credenciales del servidor en un sandbox real.",
          items: WarningSchema,
        },
      },
    },
    502: { description: "Error de la pasarela (CONNECTION_FAILED, GATEWAY_SERVER_ERROR, MALFORMED_RESPONSE, MAX_RETRIES_EXCEEDED).", ...KitPagosErrorSchema },
    504: { description: "Timeout de la pasarela.", ...KitPagosErrorSchema },
  },
} as const;

// ---------------------------------------------------------------------------
// POST /v1/api/webhooks/:gateway
// ---------------------------------------------------------------------------

export const PostWebhooksSchema = {
  tags: ["Kit Pagos"],
  summary: "Verificar webhook de pasarela",
  description:
    "Verifica la firma de una notificación de pasarela y devuelve el evento normalizado. " +
    "El comercio recibe el webhook de la pasarela y lo reenvía byte a byte a este endpoint " +
    "(cuerpo exacto, cabeceras originales, query string incluido). " +
    "Cualquier rechazo —firma inválida, cuerpo malformado, marca de tiempo vencida o secreto sin configurar— " +
    "responde 401 con el mismo cuerpo, sin revelar la causa.",
  security: [{ bearerAuth: [] }],
  params: {
    type: "object",
    required: ["gateway"],
    properties: {
      gateway: {
        type: "string",
        enum: ["wompi", "mercadopago", "kushki", "rapyd"],
        description: "Pasarela que emitió el webhook.",
      },
    },
  },
  response: {
    200: {
      description: "Firma válida. Evento normalizado.",
      type: "object",
      required: ["gateway", "eventType", "newStatus"],
      properties: {
        gateway: { type: "string", example: "wompi" },
        eventType: { type: "string", example: "TRANSACTION_UPDATED" },
        gatewayTransactionId: { type: "string" },
        newStatus: {
          type: "string",
          enum: TRANSACTION_STATUS_ENUM,
        },
      },
    },
    400: { description: "Pasarela no soportada.", ...KitPagosErrorSchema },
    401: {
      description: "Firma inválida, cuerpo malformado, marca de tiempo vencida o secreto sin configurar.",
      ...KitPagosErrorSchema,
    },
  },
} as const;

// ---------------------------------------------------------------------------
// GET /v1/api/payments/:id
// ---------------------------------------------------------------------------

export const GetPaymentStatusSchema = {
  tags: ["Kit Pagos"],
  summary: "Consultar estado de un pago",
  description:
    "Consulta el estado de una transacción previamente creada a través del SDK. " +
    "El parámetro `gateway` es obligatorio en el query string para dirigir la consulta a la pasarela correcta.",
  security: [{ bearerAuth: [] }],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: {
        type: "string",
        description: "Identificador de la transacción en la pasarela (gatewayTransactionId).",
        example: "12345-67890",
      },
    },
  },
  querystring: {
    type: "object",
    required: ["gateway"],
    properties: {
      gateway: {
        type: "string",
        description: "Pasarela por la que se procesó la transacción: wompi, mercadopago, kushki o rapyd.",
        example: "wompi",
      },
    },
  },
  headers: {
    type: "object",
    properties: GatewayCredentialHeaders,
  },
  response: {
    200: {
      description: "Estado normalizado de la transacción.",
      type: "object",
      additionalProperties: true,
      required: ["gateway", "transaction"],
      properties: {
        gateway: { type: "string", example: "wompi" },
        transaction: {
          type: "object",
          required: ["gatewayTransactionId", "orderReference", "amount", "currency", "status", "isApproved", "isPending", "isFinal"],
          properties: {
            gatewayTransactionId: { type: "string", example: "12345-67890" },
            orderReference: { type: "string", example: "ORD-001" },
            amount: { type: "string", example: "50000.00" },
            currency: { type: "string", example: "COP" },
            status: {
              type: "string",
              enum: TRANSACTION_STATUS_ENUM,
            },
            rawStatus: { type: "string", description: "Estado nativo devuelto por la pasarela." },
            isApproved: { type: "boolean" },
            isPending: { type: "boolean" },
            isFinal: { type: "boolean" },
            authorizationCode: { type: "string" },
            rejectionReason: {
              type: "object",
              properties: {
                code: { type: "string" },
                category: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
        warnings: {
          type: "array",
          description: "Advertencias cuando se usaron credenciales del servidor en un sandbox real.",
          items: WarningSchema,
        },
      },
    },
    400: { description: "Petición inválida o pasarela no soportada.", ...KitPagosErrorSchema },
    401: { description: "Token Bearer ausente o credenciales insuficientes.", ...UnauthorizedSchema },
    404: { description: "Transacción no encontrada en la pasarela.", ...KitPagosErrorSchema },
    502: { description: "Error de la pasarela o reintentos agotados.", ...KitPagosErrorSchema },
    504: { description: "Timeout de la pasarela.", ...KitPagosErrorSchema },
  },
} as const;

// ---------------------------------------------------------------------------
// GET /v1/api/pse-banks
// ---------------------------------------------------------------------------

export const GetPseBanksSchema = {
  tags: ["Kit Pagos"],
  summary: "Bancos PSE disponibles",
  description:
    "Devuelve la lista de entidades financieras habilitadas para PSE según la pasarela indicada. " +
    "Cada banco incluye su code (el que usa la pasarela) y, cuando existe, su achCode (código de compensación ACH, igual en las cuatro pasarelas). " +
    "Si se omite el parámetro gateway y se usan credenciales del servidor, devuelve la lista de las cuatro pasarelas.",
  security: [{ bearerAuth: [] }],
  querystring: {
    type: "object",
    properties: {
      gateway: {
        type: "string",
        description: "Pasarela de la que se pide el catálogo: wompi, mercadopago, kushki o rapyd. Opcional si se usan las credenciales del servidor.",
        example: "wompi",
      },
    },
  },
  headers: {
    type: "object",
    properties: GatewayCredentialHeaders,
  },
  response: {
    200: {
      description: "Lista de bancos PSE agrupados por pasarela.",
      type: "object",
      additionalProperties: true,
      required: ["pseBanks"],
      properties: {
        pseBanks: {
          type: "array",
          items: {
            type: "object",
            required: ["gateway", "banks"],
            properties: {
              gateway: { type: "string", example: "wompi" },
              banks: {
                type: "array",
                items: {
                  type: "object",
                  required: ["code", "name"],
                  properties: {
                    code: { type: "string", description: "Código propio de la pasarela.", example: "1007" },
                    name: { type: "string", example: "Bancolombia" },
                    achCode: {
                      type: "string",
                      description: "Código de compensación ACH (PseBankCode). Ausente en bancos de prueba de los sandboxes.",
                      example: "1007",
                    },
                  },
                },
              },
            },
          },
        },
        warnings: {
          type: "array",
          description: "Advertencias cuando se usaron credenciales del servidor en un sandbox real.",
          items: WarningSchema,
        },
      },
    },
    400: { description: "Pasarela no soportada o parámetro ausente.", ...KitPagosErrorSchema },
    401: { description: "Token Bearer ausente o credenciales insuficientes.", ...UnauthorizedSchema },
    502: { description: "Error de la pasarela al consultar los bancos.", ...KitPagosErrorSchema },
  },
} as const;
