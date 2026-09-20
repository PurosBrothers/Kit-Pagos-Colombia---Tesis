# Clase por clase

Todas las clases y módulos del SDK, por capa, cada uno con su responsabilidad y con el porqué de estar hecho así. Las 61 unidades de producción de `sdk/src`.

Cuando una decisión parece rara, casi siempre tiene una razón medida detrás, y está citada.

---

## Dominio — `sdk/src/domain/` (29 archivos)

### La entidad

#### `Transaction`

La **única** entidad del dominio: el único concepto que necesita identidad propia a lo largo del tiempo, porque su estado cambia de `PENDING` a `APPROVED` sin dejar de ser la misma transacción.

Ocho campos y cuatro métodos:

```28:55:sdk/src/domain/entities/Transaction.ts
  constructor(
    public readonly gatewayTransactionId: GatewayTransactionId,
    public readonly orderReference: OrderReference,
    public readonly amount: Amount,
    public readonly currency: Currency,
    public readonly payer: Payer,
    private readonly status: TransactionStatus,
    public readonly rawStatus: string,
    public readonly rejectionReason?: RejectionReason,
    public readonly authorizationCode?: string,
  ) {}

  getStatus(): TransactionStatus { /* ... */ }
  isApproved(): boolean { /* ... */ }
  isPending(): boolean { /* ... */ }
  isFinal(): boolean { /* ... */ }
```

Tres cosas que vale la pena notar:

**`status` es privado y los demás campos son públicos.** El estado se lee por `getStatus()` y no directamente, para que existan `isApproved()`, `isPending()` e `isFinal()` como la forma natural de preguntar. `isFinal()` es la que más se usa en la práctica: es lo que un trabajo de conciliación necesita para saber si tiene que volver a consultar.

**`rawStatus` conserva el texto nativo de la pasarela.** Se podría considerar contaminación del dominio, pero es lo contrario: cuando hay que escribirle al soporte de la pasarela, o auditar por qué el SDK tradujo algo de una manera, hace falta el original. Traducir y descartar el insumo hace la traducción imposible de verificar.

**Es inmutable.** Cuando una transacción `PENDING` se concilia por webhook, el normalizador **construye una instancia nueva** en lugar de modificar la existente (punto 3). Así una transacción que se pasó a otra función no puede cambiar bajo los pies de nadie.

### Los objetos de valor (20 archivos)

#### `Amount` — el que más historia tiene

Guarda una **cadena decimal canónica**, no un `number`, y rechaza `number` explícitamente en el constructor.

La razón corta: **Rapyd firma sus peticiones con un HMAC sobre el cuerpo serializado**, y ahí `"19.90"` y `"19.9"` son textos distintos que producen firmas distintas, de las cuales solo una es válida. Con un `number`, el cero final se pierde antes de llegar al adaptador y no hay forma de recuperarlo.

La razón larga incluye un dato que sorprende: validar "máximo dos decimales" con `Math.round(value * 100) !== value * 100` **rechaza montos legítimos**, medido en Node:

```text
1.15  * 100 = 114.99999999999999   -> rechazado, y es un monto válido
19.99 * 100 = 1998.9999999999998   -> rechazado, y es un monto válido
```

La comprobación de tipo en tiempo de ejecución existe porque el paquete se publica en npm y lo puede consumir JavaScript sin tipos, donde el compilador no defiende nada.

Historia completa: [money-representation-analysis.md](../architecture/money-representation-analysis.md) y punto 25 del architecture-log. La auditoría inicial concluyó que `number` estaba bien; se revirtió al medir el caso de Rapyd.

#### `big-arithmetic.ts` y `minor-units.ts` — dos costuras, a propósito

**`big-arithmetic.ts` es el único archivo del SDK que importa `big.js`.** Recibe cadenas, devuelve cadenas, y `big.js` no se escapa de ahí. Se puede verificar:

```bash
grep -rln 'from "big.js"' sdk/src/   # un solo archivo
```

Aislarlo tiene dos beneficios concretos: cambiar de librería decimal toca un archivo, y ningún otro módulo puede recibir un objeto `Big` por accidente y filtrar su API.

**`minor-units.ts` convierte entre unidad mayor y menor** según el exponente ISO 4217 de la divisa. Está separado porque es una responsabilidad distinta: uno opera sobre números decimales, el otro sabe de divisas. Y sobre todo, porque **corre el punto decimal sobre el texto** en lugar de multiplicar por cien. Multiplicar reintroduce el error de punto flotante; dividir borra el cero final. Están juntos en el punto 33 del architecture-log.

#### `PaymentResult` — la unión que obliga a manejar la redirección

```59:71:sdk/src/domain/value-objects/PaymentResult.ts
export interface TransactionOutcome {
  readonly outcome: "TRANSACTION";
  readonly transaction: Transaction;
}

export interface RedirectRequiredOutcome {
  readonly outcome: "REDIRECT_REQUIRED";
  readonly redirect: PendingRedirect;
}

export type PaymentResult = TransactionOutcome | RedirectRequiredOutcome;
```

**Por qué una unión discriminada y no un campo opcional.** La alternativa era `Transaction` con un `redirectUrl?: string`. Con eso, un comercio que se olvidara de la redirección compilaría sin problema y el defecto aparecería en producción como un pago de PSE que nunca avanza. Con la unión, el compilador no permite leer `transaction` sin haber distinguido el caso: **olvidarse es un error de compilación**. Punto 39 del architecture-log.

`PendingRedirect` incluye el `gatewayTransactionId`, y eso es deliberado: sin él, un pago redirigido sería irrastreable si el pagador nunca vuelve. También hay una guarda que impide construir una redirección con URL vacía, porque un resultado que dice "redirigí" sin decir a dónde es peor que un error.

#### `PaymentMethod` — dos constructores y ningún número de tarjeta

`PaymentMethod.card(token)` y `PaymentMethod.pse({ bankCode, payerKind })`. Recibe un **token**, nunca un número de tarjeta: la tokenización vive en el frontend con la librería del proveedor, y aceptar el número metería al comercio en el alcance de PCI DSS.

`bankCode` es una **cadena opaca** y no un enum, porque los códigos de banco no son portables entre pasarelas y mantener un catálogo de equivalencias sincronizado con cuatro proveedores es peor que no tenerlo: uno desactualizado manda al pagador al banco equivocado.

#### `TaxBreakdown` — el desglose que solo Kushki exige

Kushki pide un objeto con subtotal gravado, subtotal exento, IVA y divisa, en lugar de un monto plano. Por defecto declara el total como exento, y verifica que las partes sumen el total. El campo `TaxBreakdown` es opcional en el puerto porque tres de las cuatro pasarelas no lo necesitan.

#### El resto de los objetos de valor

| Archivo | Qué representa |
|---|---|
| `Currency` | Código ISO 4217, `COP` por defecto, y el exponente de unidad menor |
| `OrderReference` | La referencia del comercio, el único identificador que el comercio controla |
| `Payer` | Datos del pagador: correo obligatorio; documento, nombre, teléfono y dirección opcionales porque no todas las pasarelas los piden |
| `GatewayTransactionId` | El id nativo **más** la pasarela que lo emitió. Van juntos porque un id sin su pasarela no se puede consultar |
| `RejectionReason` | Código de rechazo nativo más su categoría normalizada |
| `ReturnUrlConfig` | Una URL de retorno o una por desenlace, con `resolveFor(status)`. Existe porque las pasarelas admiten entre una y tres |
| `PseBank` | Código opaco más nombre |
| `Credentials` | `publicKey`, `privateKey`, y los opcionales `webhookSecret` e `integritySecret` |
| `WebhookEvent` | El evento normalizado que devuelve la validación |
| `TransactionStatus` | Los seis estados normalizados |
| `RejectionCategory` | Las categorías de rechazo |
| `Gateway` | Las cuatro pasarelas |
| `KitPagosErrorCode` | Los doce códigos de error |

### Los servicios de dominio

#### `WebhookVerifier` y los cuatro manejadores

`WebhookVerifier` es un **despachador sin estado**: elige el manejador según la pasarela y delega. Cada manejador implementa `verify()` y `parse()` con el algoritmo de su pasarela. Las cuatro fórmulas están en [01-producto/2-conceptos-tecnicos.md](../01-producto/2-conceptos-tecnicos.md) §4.

#### `signature-utils.ts` — el único importador de `crypto` en el dominio

Tres funciones: comparación en tiempo constante, SHA-256 hexadecimal y HMAC-SHA256 con codificación configurable.

**La comparación en tiempo constante es la razón de ser del módulo.** Usar `===` sobre firmas filtra información por temporización: corta en el primer byte distinto, así que tarda un poco más cuando los primeros bytes coinciden, y con suficientes mediciones un atacante reconstruye la firma byte por byte en lugar de tener que adivinarla completa. `crypto.timingSafeEqual` recorre siempre todos los bytes, y exige que los buffers midan lo mismo, así que hay que comparar longitudes antes (eso sí puede ser directo: la longitud no es secreta).

Concentrar esto en un archivo tiene un beneficio verificable: **auditar que las cuatro verificaciones son en tiempo constante es leer un archivo.**

#### `native-status.ts` — las tablas de estado

Traduce los vocabularios nativos a los seis estados normalizados. Está en el dominio porque **el significado** de esos textos es una regla de negocio: decidir que `CLO` con `paid: true` es una aprobación y que `CLO` a secas no lo es es la definición de qué cuenta como pago exitoso.

Kushki tiene **dos tablas separadas**, una para tarjeta y otra para transferencia, porque usa vocabularios distintos según el método. Los estados intermedios de transferencia (`requestedToken`, `initializedTransaction`) no estaban en la tabla original, y por eso una transferencia en curso se reportaba como error (punto 48).

**Un estado desconocido se traduce a `ERROR`, no a aprobado.** La dirección del valor por defecto importa: así, una pasarela que agregue un estado nuevo produce un error visible en lugar de una aprobación falsa.

### El error

#### `KitPagosError`

```5:13:sdk/src/domain/errors/KitPagosError.ts
export class KitPagosError extends Error {
  constructor(
    public readonly code: KitPagosErrorCode,
    public readonly gateway: Gateway,
    public readonly originalPayload: unknown,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "KitPagosError";
  }
```

Código tipado para programar contra un catálogo cerrado; pasarela de origen, que con cuatro adaptadores es la primera pregunta al depurar; y payload original, porque ningún catálogo cubre todo y el soporte de la pasarela pide lo que ella dijo, literal.

> Se llamaba `SdkError`, con su enum `SdkErrorCode`. Si aparecen esos nombres en algún documento, es una referencia obsoleta.

---

## Aplicación — `sdk/src/application/` (13 archivos)

### `PaymentGatewayPort` — el contrato

Cuatro operaciones, y ni una mención de HTTP, de un header, de un formato de cuerpo ni del nombre de una pasarela. Todos los tipos que entran y salen son del dominio. **Este archivo es la frontera hexagonal**, y de un lado nadie sabe que del otro hay red.

`CreatePaymentRequest` tiene cuatro campos obligatorios —monto, divisa, referencia y pagador— y cuatro opcionales —URLs de retorno, desglose de IVA, método de pago y dirección IP—, opcionales porque no todas las pasarelas los piden. Cada adaptador exige los suyos.

### `ResponseNormalizer` y los cuatro normalizadores

Traducen la respuesta cruda de cada pasarela a una `Transaction`. El despachador elige por pasarela; cada normalizador sabe dónde vive cada dato en su formato: Wompi envuelve en `data` y usa centavos, Mercado Pago pone el pago en la raíz y el monto en pesos.

**Esto era un solo método de 360 líneas con un `switch` gigante**, y la historia de por qué se dividió vale por sí sola: ese método puntuaba **WMC 1** con la fórmula de métricas de entonces, o sea "trivial". La fórmula contaba métodos y no su complejidad. Se corrigió la fórmula, el método saltó a un valor altísimo, y eso forzó la división. Punto 34 del architecture-log, y es el mejor ejemplo del proyecto de que una métrica mal definida es peor que ninguna: da una falsa sensación de control.

Tres módulos auxiliares: `kushki-card.ts` y `kushki-transfer.ts` separan los dos vocabularios de Kushki, `rapyd-redirect.ts` extrae la redirección del checkout y del PSE, y `payload-utils.ts` tiene el parseo compartido.

### `RetryHandler`

Retroceso exponencial con fluctuación. Por defecto: 3 reintentos, espera base de 1 s que se duplica, tope de 4 s, fluctuación de hasta 200 ms.

Dos detalles de diseño:

**Delega en `ErrorHandler` la decisión de qué es transitorio**, en lugar de tener su propia lista. Si tuviera la propia, habría dos catálogos de errores que se desincronizarían.

**El reloj es inyectable.** El constructor acepta una función `sleep`, así que las pruebas verifican la política entera sin esperar de verdad. Una suite que comprobara tres reintentos con esperas reales tardaría siete segundos, y una suite lenta se deja de correr.

### `ErrorHandler`

Traduce cualquier fallo a `KitPagosError`. Y está dividido **por forma del error, no por pasarela**: un timeout es un timeout en las cuatro, un 404 es un recurso que no existe en las cuatro. Dividirlo por proveedor habría producido cuatro copias de la misma lógica y cuatro lugares donde arreglar el mismo defecto.

Exporta `isRetriable()`, que es lo que consume el `RetryHandler`.

---

## Infraestructura — `sdk/src/infrastructure/` (17 archivos)

### `KitPagos` — la fachada

Cuatro métodos públicos, y adentro: resolver el adaptador, envolver en reintentos solo lo idempotente, y traducir los fallos de verificación de webhook a códigos del catálogo.

**Resuelve el adaptador en cada llamada y no en el constructor**, para que reconfigurar tome efecto de inmediato.

### `SdkConfigurator`

Guarda la pasarela activa, un mapa de credenciales por pasarela, la `baseUrl`, los reintentos y la tolerancia de webhook.

**`baseUrl` admite una cadena o un mapa por pasarela**, y esa es una corrección que salió de un límite real: Mercado Pago necesita dos rutas distintas —`/payments` y `/orders`—, y con una sola `baseUrl` global no había forma de apuntar cada pasarela a un host distinto. Hoy se puede, y eso habilita algo importante: **el SDK puede hablar con los sandboxes reales sin pasar por el simulador**, que es justo lo que hacen las pruebas de contrato (punto 57).

Guarda **todas** las credenciales configuradas y no solo las de la pasarela activa. Es lo que permite validar un webhook de la pasarela anterior durante una migración.

### `GatewayFactory`

Recibe la pasarela y devuelve el adaptador. El único `switch` sobre `Gateway` en todo el SDK.

Su valor está en esa unicidad: **es el único lugar que hay que tocar para agregar una quinta pasarela**, y por lo tanto el único lugar donde se puede olvidar de agregarla. Mejor eso que cuatro archivos donde el olvido pueda ocurrir.

### Los cuatro adaptadores y sus once módulos auxiliares

| Adaptador | Módulos auxiliares |
|---|---|
| `WompiAdapter` | `wompi-pse.ts` (flujo PSE y firma de integridad) |
| `MercadoPagoAdapter` | `mercadopago-pse.ts` (Orders API) |
| `KushkiAdapter` | `kushki-charge.ts`, `kushki-pse.ts`, `kushki-amount.ts` |
| `RapydAdapter` | `rapyd-signature.ts`, `rapyd-checkout.ts`, `rapyd-pse.ts`, `rapyd-payload.ts` |
| Compartido | `payment-method-support.ts` |

**Por qué hay tantos módulos auxiliares.** Cada uno salió de que un adaptador crecía más de lo que los umbrales de métricas CK permiten. Pero la razón más valiosa no es la métrica: **un módulo extraído se puede probar sin montar una respuesta HTTP falsa completa.** La firma de Rapyd, por ejemplo, se prueba con un vector calculado de forma independiente, escrito aparte del código de producción a propósito: si alguien "simplifica" la firma a `digest("base64")`, o deja de pasar el método en minúsculas, esa prueba falla. Sin un vector independiente, una prueba de firma solo verificaría que el código coincide consigo mismo.

`payment-method-support.ts` es la guarda compartida que rechaza un método no soportado con `UNSUPPORTED_OPERATION`. Existe aunque los tipos ya lo impidan, porque el paquete se publica en npm y lo puede consumir JavaScript sin tipos.

El HTTP concreto de cada uno está en [3-las-pasarelas-por-dentro.md](3-las-pasarelas-por-dentro.md).

---

## `index.ts` — la superficie pública

Lo que no está acá, el comercio no lo puede usar aunque exista. Y tiene una prueba de fuego permanente: el paquete de `examples/` importa **por el nombre público** (`kit-pagos-colombia`), nunca por rutas relativas, así que cualquier tipo que falte rompe la compilación de los ejemplos. Fue así como se detectó que faltaban cuatro tipos exportados (punto 21).

## `test-support/payment-result.ts`

Ayudas usadas solo por las pruebas, para no repetir en 35 archivos la construcción del resultado de un pago. No entra en el paquete publicado: `tsconfig.build.json` excluye las pruebas.

---

## Qué sigue

- El HTTP de cada pasarela: [3-las-pasarelas-por-dentro.md](3-las-pasarelas-por-dentro.md).
- Cómo se usa todo esto: [4-guia-de-implementacion.md](4-guia-de-implementacion.md).
- Cómo se mide que estas clases cumplen los umbrales: [04-metricas-y-pruebas/1-metricas-ck.md](../04-metricas-y-pruebas/1-metricas-ck.md).
