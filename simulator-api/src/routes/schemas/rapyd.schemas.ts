/**
 * Schemas OpenAPI/JSON-Schema para las rutas de simulación de Rapyd (issue #107).
 *
 * Cada schema se define de forma desacoplada y se asocia a cada ruta en Fastify.
 * Fastify valida las peticiones entrantes sin recortar campos de respuesta (gracias a
 * `compileSchemasAsIs`) y expone la especificación OpenAPI 3.0 en /docs.
 *
 * Puntos de diseño y mediciones registradas en architecture-log.md:
 * - Rapyd envuelve todas sus respuestas en `{ status, data }`, donde `status` describe
 *   el resultado de la operación de API y `data` el objeto de negocio.
 * - La divisa entra como `currency` en la petición y sale como `currency_code` en la respuesta.
 * - Flujo de tarjeta: Rapyd utiliza checkout alojado (`POST /v1/sim/rapyd/checkout`) en lugar
 *   de tokenización servidor a servidor (punto 47). La respuesta responde HTTP 200 (medido) y nace en 'NEW'.
 * - La ruta `GET /v1/sim/rapyd/checkout/:checkoutId/pagar` (y `/pay`) es una facilidad del
 *   simulador sin equivalente en la API real de Rapyd, para avanzar el flujo sin navegador.
 * - Flujo PSE: son dos llamadas (1. POST /customers para crear cliente, 2. POST /payments con
 *   `customer` obligatorio y método `co_pse_*`). Nace activo (ACT, paid: false, next_action: pending_confirmation).
 * - En la consulta `GET /payments/:paymentId`, un pago inexistente responde HTTP 400 con ERROR_GET_PAYMENT (medido, no 404).
 * - `x-simulate-scenario` se compara sin distinguir mayúsculas (.toUpperCase()). Admite APPROVED,
 *   APPROVAL, DECLINED, REJECTED, EXPIRED, PENDING (solo PSE), FLAPPING, DUPLICATE_PAYMENT. Todo lo demás responde 501.
 */

const TAGS = ["Rapyd Simulación"];

// ─── Componentes y fragmentos reutilizables ───

const rapydStatusSchema = {
  type: "object",
  description: "Envoltorio de estado de operación de la API de Rapyd.",
  properties: {
    error_code: { type: "string", example: "" },
    status: { type: "string", enum: ["SUCCESS", "ERROR"], example: "SUCCESS" },
    message: { type: "string", example: "" },
    response_code: { type: "string", example: "" },
    operation_id: { type: "string", example: "55b09891031c71902f5652f8eb304e70" },
  },
  required: ["error_code", "status", "message", "response_code", "operation_id"],
} as const;

const simulateScenarioHeader = {
  type: "string",
  description:
    "Cabecera de control de simulación. Comparada sin distinguir mayúsculas. Admite: " +
    "APPROVED, APPROVAL, DECLINED, REJECTED, EXPIRED, PENDING (PSE), FLAPPING, DUPLICATE_PAYMENT, " +
    "y fallas técnicas. Cualquier otro valor responde 501 (escenario aún no soportado).",
  example: "APPROVED",
} as const;

const rapydPaymentSchema = {
  type: "object",
  description: "Objeto de negocio Payment de Rapyd dentro de data.",
  properties: {
    id: {
      type: "string",
      description: "Identificador del pago con prefijo payment_.",
      example: "payment_02beac7ac67d19a655039bb8127d3d57",
    },
    status: {
      type: "string",
      enum: ["ACT", "CLO", "ERR", "EXP", "REV"],
      description: "Estado del pago (ACT=activo/pendiente, CLO=cerrado/final, ERR=error, EXP=expirado).",
      example: "CLO",
    },
    paid: {
      type: "boolean",
      description: "Discriminante de aprobación: solo si CLO y paid=true el pago está aprobado.",
      example: true,
    },
    amount: {
      type: ["number", "string"],
      description: "Monto en la unidad mayor (pesos, no centavos).",
      example: 50000,
    },
    currency_code: {
      type: "string",
      description: "Divisa de la respuesta (currency_code, no currency).",
      example: "COP",
    },
    merchant_reference_id: {
      type: "string",
      description: "Referencia del comercio enviada en la creación.",
      example: "REF-12345",
    },
    receipt_email: { type: "string", example: "" },
    failure_code: { type: "string", example: "" },
    failure_message: { type: "string", example: "" },
    created_at: { type: "number", example: 1793487613 },
    next_action: {
      type: "string",
      description: "Siguiente acción requerida ('pending_confirmation' para PSE).",
      example: "not_applicable",
    },
    redirect_url: {
      type: "string",
      format: "uri",
      description: "URL de redirección para completar la autorización.",
      example: "http://localhost:3000/v1/sim/rapyd/complete-bank-payment?token=payment_123",
    },
    customer: {
      type: "string",
      description: "Identificador del cliente asociado.",
      example: "cus_12345",
    },
  },
  required: [
    "id",
    "status",
    "paid",
    "amount",
    "currency_code",
    "merchant_reference_id",
    "created_at",
  ],
} as const;

const rapydCheckoutSchema = {
  type: "object",
  description: "Objeto de negocio Checkout de Rapyd dentro de data.",
  properties: {
    id: {
      type: "string",
      description: "Identificador de la página de pago con prefijo checkout_.",
      example: "checkout_e8aef5d1779ccadea468f9543b34ac0c",
    },
    status: {
      type: "string",
      enum: ["NEW", "DON", "EXP", "ERR"],
      description: "Estado del checkout (NEW al crearse, DON tras pagarse).",
      example: "NEW",
    },
    redirect_url: {
      type: "string",
      format: "uri",
      description: "URL de la página de pago alojada a la que debe redirigirse al pagador.",
      example: "http://localhost:3000/v1/sim/rapyd/checkout/checkout_e8aef5d1779ccadea468f9543b34ac0c/pay",
    },
    payment: {
      type: "object",
      description: "Detalle inicial o final del pago atado al checkout.",
      properties: {
        id: { type: ["string", "null"], example: null },
        status: { type: ["string", "null"], example: null },
        amount: { type: ["number", "string"], example: 50000 },
        currency_code: { type: "string", example: "COP" },
        merchant_reference_id: { type: "string", example: "REF-12345" },
      },
    },
  },
  required: ["id", "status", "redirect_url"],
} as const;

// ─── 1. POST /v1/sim/rapyd/payments ───

export const postPaymentsSchema = {
  summary: "Crear pago directo en Rapyd",
  description:
    "Crea un cobro en Rapyd Collect. Envuelve la respuesta en { status, data }. " +
    "Con tarjeta el cobro nace resuelto (status CLO, paid true o false según escenario). " +
    "Con PSE (método de pago con prefijo 'co_pse_') el campo customer es OBLIGATORIO y el pago nace " +
    "activo (status ACT, paid false, next_action pending_confirmation, con redirect_url bancaria). " +
    "En la respuesta la divisa se nombra currency_code y el monto se reporta en pesos (unidad mayor). " +
    "Escenarios no soportados responden 501.",
  tags: TAGS,
  headers: {
    type: "object",
    properties: {
      "x-simulate-scenario": simulateScenarioHeader,
    },
  },
  body: {
    type: "object",
    properties: {
      amount: {
        type: ["number", "string"],
        description: "Monto del pago en pesos (unidad mayor). Acepta string numérico (ej. '50000.00').",
        example: 50000,
      },
      currency: {
        type: "string",
        description: "Divisa de la petición (ej. 'COP').",
        example: "COP",
      },
      merchant_reference_id: {
        type: "string",
        description: "Referencia única del comercio.",
        example: "REF-12345",
      },
      receipt_email: { type: "string", format: "email", example: "cliente@example.com" },
      complete_payment_url: { type: "string", format: "uri" },
      error_payment_url: { type: "string", format: "uri" },
      payment_method: {
        type: "object",
        description: "Método de pago (ej. { type: 'co_pse_bancolombia_bank' } para PSE).",
        properties: {
          type: { type: "string", example: "co_visa_card" },
        },
      },
      customer: {
        type: "string",
        description: "Identificador del cliente (obligatorio para transferencias PSE).",
        example: "cus_12345",
      },
    },
    required: ["amount", "currency", "merchant_reference_id"],
  },
  response: {
    201: {
      description: "Pago creado exitosamente en Rapyd.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
        data: rapydPaymentSchema,
      },
      required: ["status", "data"],
    },
    400: {
      description: "Error de validación (ej. falta customer en PSE).",
      type: "object",
      properties: {
        status: rapydStatusSchema,
      },
    },
    409: {
      description: "merchant_reference_id duplicado (escenario DUPLICATE_PAYMENT).",
      type: "object",
      properties: {
        status: rapydStatusSchema,
      },
    },
    501: {
      description: "Escenario de simulación no soportado.",
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

// ─── 2. GET /v1/sim/rapyd/payments/:paymentId ───

export const getPaymentByIdSchema = {
  summary: "Consultar pago por paymentId en Rapyd",
  description:
    "Consulta un pago registrado mediante su identificador `payment_...`. " +
    "NOTA DE COMPORTAMIENTO MEDIDO: Si el pago no existe, Rapyd responde HTTP 400 con ERROR_GET_PAYMENT " +
    "(no 404). Si el pago nació en estado activo (ACT) por PSE, la consulta evalúa la máquina de estados " +
    "y avanza a CLO según el escenario acordado en la creación.",
  tags: TAGS,
  params: {
    type: "object",
    properties: {
      paymentId: {
        type: "string",
        description: "Identificador de pago en Rapyd con prefijo payment_.",
        example: "payment_02beac7ac67d19a655039bb8127d3d57",
      },
    },
    required: ["paymentId"],
  },
  response: {
    200: {
      description: "Detalle del pago consultado.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
        data: rapydPaymentSchema,
      },
      required: ["status", "data"],
    },
    400: {
      description: "Pago no encontrado o identificador inválido.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
      },
    },
  },
} as const;

// ─── 3. POST /v1/sim/rapyd/checkout ───

export const postCheckoutSchema = {
  summary: "Crear página de checkout alojada en Rapyd",
  description:
    "Crea una sesión de página de pago alojada (hosted checkout). Es el flujo soportado por Rapyd para tarjeta " +
    "en el proyecto, evitando que los datos sensibles pasen por el backend del comercio. " +
    "NOTA DE COMPORTAMIENTO MEDIDO: Responde HTTP 200 (a diferencia de /payments que responde 201). " +
    "El checkout nace en estado NEW con su redirect_url. Los datos persisten en rapydCheckouts.",
  tags: TAGS,
  headers: {
    type: "object",
    properties: {
      "x-simulate-scenario": simulateScenarioHeader,
    },
  },
  body: {
    type: "object",
    properties: {
      amount: {
        type: ["number", "string"],
        description: "Monto total en pesos (unidad mayor).",
        example: 50000,
      },
      currency: {
        type: "string",
        description: "Código de divisa.",
        example: "COP",
      },
      country: {
        type: "string",
        description: "Código de país de dos letras (CO).",
        example: "CO",
      },
      merchant_reference_id: {
        type: "string",
        description: "Referencia del pedido en el comercio.",
        example: "REF-12345",
      },
      complete_payment_url: { type: "string", format: "uri" },
      error_payment_url: { type: "string", format: "uri" },
    },
    required: ["amount", "currency", "country"],
  },
  response: {
    200: {
      description: "Sesión de checkout creada exitosamente.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
        data: rapydCheckoutSchema,
      },
      required: ["status", "data"],
    },
    400: {
      description: "Campos requeridos faltantes (amount, currency o country).",
      type: "object",
      properties: {
        status: rapydStatusSchema,
      },
    },
    501: {
      description: "Escenario de simulación no soportado.",
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

// ─── 4. GET /v1/sim/rapyd/checkout/:checkoutId ───

export const getCheckoutByIdSchema = {
  summary: "Consultar checkout por checkoutId en Rapyd",
  description:
    "Consulta el estado de una página de pago alojada mediante `checkout_...`. " +
    "NOTA ARQUITECTÓNICA: Es una ruta separada de /payments; consultar un identificador de checkout en /payments " +
    "devuelve 400 ERROR_GET_PAYMENT en la API real de Rapyd. Si el checkout no existe responde 400 ERROR_GET_HOSTED_PAGE_PAYMENT.",
  tags: TAGS,
  params: {
    type: "object",
    properties: {
      checkoutId: {
        type: "string",
        description: "Identificador del checkout con prefijo checkout_.",
        example: "checkout_e8aef5d1779ccadea468f9543b34ac0c",
      },
    },
    required: ["checkoutId"],
  },
  response: {
    200: {
      description: "Detalle del checkout encontrado.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
        data: rapydCheckoutSchema,
      },
      required: ["status", "data"],
    },
    400: {
      description: "Página de checkout no encontrada.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
      },
    },
  },
} as const;

// ─── 5. GET /v1/sim/rapyd/checkout/:checkoutId/pagar y /pay ───

export const getCheckoutPagarSchema = {
  summary: "Simular pago de checkout alojado (facilidad del simulador)",
  description:
    "ADVERTENCIA ARQUITECTÓNICA: Esta ruta es una facilidad exclusiva del simulador sin equivalente en la API real de Rapyd. " +
    "Representa la visita del pagador al formulario de Rapyd: transiciona el checkout de 'NEW' a 'DON', crea el " +
    "registro consultable en rapydPayments y devuelve una página HTML de confirmación (o redirige con 308 desde /pagar a /pay).",
  tags: TAGS,
  params: {
    type: "object",
    properties: {
      checkoutId: {
        type: "string",
        description: "Identificador del checkout a pagar.",
        example: "checkout_e8aef5d1779ccadea468f9543b34ac0c",
      },
    },
    required: ["checkoutId"],
  },
  response: {
    200: {
      description: "Página HTML de confirmación de pago.",
      type: "string",
    },
    308: {
      description: "Redirección permanente desde /pagar a /pay.",
      type: "string",
    },
    404: {
      description: "Página de checkout no encontrada.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
      },
    },
  },
} as const;

// ─── 6. POST /v1/sim/rapyd/customers ───

export const postCustomersSchema = {
  summary: "Crear cliente en Rapyd",
  description:
    "Paso 1 del flujo PSE en Rapyd: crea la entidad customer requerida antes de generar un cobro por transferencia. " +
    "Rapyd valida obligatoriamente el campo name antes que cualquier otro.",
  tags: TAGS,
  body: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Nombre completo del pagador.",
        example: "Juan Perez",
      },
      email: {
        type: "string",
        format: "email",
        description: "Correo electrónico del pagador.",
        example: "juan@example.com",
      },
      phone_number: {
        type: "string",
        description: "Teléfono de contacto.",
        example: "+573001234567",
      },
    },
    required: ["name"],
  },
  response: {
    200: {
      description: "Cliente creado exitosamente.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
        data: {
          type: "object",
          properties: {
            id: { type: "string", example: "cus_e92f25931152714a32f3c1e6fb9a8881" },
            name: { type: "string", example: "Juan Perez" },
            email: { type: "string", example: "juan@example.com" },
            phone_number: { type: "string", example: "+573001234567" },
            created_at: { type: "number", example: 1793487613 },
          },
          required: ["id", "name", "created_at"],
        },
      },
      required: ["status", "data"],
    },
    400: {
      description: "Nombre de cliente inválido o faltante.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
      },
    },
  },
} as const;

// ─── 7. GET /v1/sim/rapyd/payment_methods/country ───

export const getPaymentMethodsCountrySchema = {
  summary: "Listar métodos de pago por país en Rapyd (bancos PSE)",
  description:
    "Retorna los métodos de pago disponibles para un país (CO), del cual el adaptador extrae la lista de " +
    "bancos para transferencias PSE (métodos cuyo type inicia con 'co_pse_').",
  tags: TAGS,
  querystring: {
    type: "object",
    properties: {
      country: {
        type: "string",
        description: "Código de país ISO de 2 letras (por omisión 'CO').",
        example: "CO",
      },
    },
  },
  response: {
    200: {
      description: "Catálogo de métodos de pago.",
      type: "object",
      properties: {
        status: rapydStatusSchema,
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", example: "co_pse_bancolombia_bank" },
              name: { type: "string", example: "Bancolombia" },
              category: { type: "string", example: "bank_redirect" },
              image: { type: "string", example: "" },
              country: { type: "string", example: "CO" },
              payment_flow_type: { type: "string", example: "BANK_REDIRECT" },
            },
            required: ["type", "name", "category", "country"],
          },
        },
      },
      required: ["status", "data"],
    },
  },
} as const;
