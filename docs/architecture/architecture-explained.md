# Arquitectura de Kit Pagos Colombia: fundamentos y su reflejo en el código

> **Proyecto:** Kit Pagos Colombia — Trabajo de Grado en Ingeniería de Sistemas
> **Institución:** Pontificia Universidad Javeriana (Bogotá)
> **Versión:** 1.0.0

## 0. Propósito de este documento

[`layers-and-components.md`](./layers-and-components.md) es la especificación oficial de arquitectura (Nivel 3 del modelo C4): describe cómo debe verse cada componente cuando el SDK esté completo. Este documento cumple un propósito distinto y complementario. Primero explica, desde cero y con vocabulario de arquitectura de software, por qué se eligió Arquitectura Hexagonal y qué problema concreto resuelve en este proyecto. Después toma esa explicación y la contrasta directamente contra el código fuente que existe hoy en `sdk/src/`, citando archivos y líneas reales, para que cualquier persona del equipo (o cualquier evaluador del trabajo de grado) pueda verificar con sus propios ojos que la teoría descrita realmente se cumple en la implementación, y no solo en el papel.

Todo el código citado aquí corresponde al estado del repositorio en la rama `devops` a la fecha de este documento. Donde el código todavía es un esqueleto sin implementar (la mayoría de la capa de aplicación y toda la infraestructura de adaptadores), se dice explícitamente, en lugar de describir como terminado algo que todavía no existe.

---

## Parte I — Fundamentos de la arquitectura

### 1. El problema que la arquitectura tiene que resolver

Antes de justificar una arquitectura hay que tener claro el problema que la motiva. Kit Pagos Colombia existe porque cuatro pasarelas de pago colombianas (Wompi, Rapyd, Mercado Pago y Kushki) exponen contratos completamente distintos entre sí: autenticación diferente, formato de solicitud diferente, nombres de estado diferentes para el mismo resultado de negocio (Kushki llama `APPROVAL` a lo que las demás llaman `APPROVED`), y mecanismos de firma de webhook distintos (SHA-256 en Wompi, HMAC-SHA256 en Mercado Pago y Kushki, HMAC-SHA256 con Base64 en Rapyd).

> **Nota:** la cuarta pasarela originalmente era PayU. Rapyd adquirió la operación de PayU en Latinoamérica en 2025, y desde 2026 el registro de comercio nuevo para Colombia ya no otorga acceso a la API clásica de PayU, sino únicamente a la API de Rapyd Collect. Ver el punto 15 de [`sad-inconsistencies.md`](./sad-inconsistencies.md) para el detalle de esta decisión.

Un comercio que quisiera integrar las cuatro pasarelas sin ningún tipo de abstracción tendría que escribir, entender y mantener cuatro veces la misma lógica de negocio (crear un pago, consultar su estado, validar un webhook), cada vez adaptada a las particularidades de un proveedor distinto. Si mañana decide cambiar de proveedor principal, o agregar un quinto, ese cambio se propaga por todo su código. Este es exactamente el tipo de problema que la Arquitectura Hexagonal fue diseñada para resolver: aislar la lógica de negocio de los detalles técnicos externos que cambian con más frecuencia que las reglas de negocio mismas.

### 2. Arquitectura Hexagonal (Puertos y Adaptadores)

La Arquitectura Hexagonal, propuesta originalmente por Alistair Cockburn, organiza un sistema en tres capas concéntricas con una regla de dependencia estricta: las capas externas pueden conocer a las internas, pero las internas nunca conocen a las externas. En Kit Pagos Colombia esas tres capas son dominio, aplicación e infraestructura, y viven literalmente como tres carpetas hermanas dentro de `sdk/src/`.

**El dominio** es el centro del hexágono. Contiene las reglas de negocio puras: qué es una transacción, qué significa que esté aprobada, qué forma tiene un monto de dinero válido. El dominio no sabe que existen HTTP, JSON, Wompi o Rapyd. No importa ninguna librería externa. Si mañana se reemplazara Fastify por Express, o Wompi dejara de existir como empresa, ni una sola línea del dominio tendría que cambiar.

**La aplicación** es la capa intermedia. Define los **puertos**, que son las interfaces abstractas a través de las cuales el dominio se comunica con el mundo exterior, y los **servicios de aplicación**, que orquestan casos de uso completos combinando el dominio con esos puertos. Un puerto no sabe quién lo va a implementar: solo define qué operaciones deben existir y con qué forma de entrada y salida.

**La infraestructura** es la capa externa. Contiene las implementaciones concretas de los puertos, llamadas **adaptadores**, que sí conocen los detalles técnicos de un proveedor específico. Aquí viven `WompiAdapter`, `RapydAdapter`, `MercadoPagoAdapter` y `KushkiAdapter`, cada uno traduciendo el contrato abstracto del puerto hacia las particularidades reales de su pasarela. También vive aquí el `KitPagos` facade, que es el punto de entrada público del SDK.

La regla de dependencia se puede resumir en una sola frase: **el dominio no importa nada de la aplicación ni de la infraestructura; la aplicación no importa nada de la infraestructura; la infraestructura importa de ambas**. Esta regla es la que hace posible que agregar una quinta pasarela algún día sea "escribir un adaptador nuevo" en lugar de "modificar el núcleo del sistema".

### 3. Diseño Táctico de Domain-Driven Design (DDD)

Dentro de la capa de dominio, el proyecto usa un subconjunto reducido pero preciso de los patrones tácticos de DDD, evitando la complejidad de un modelo de dominio grande cuando el problema no la necesita.

**Entidad.** Una entidad tiene identidad propia: dos instancias con los mismos datos siguen siendo objetos distintos si representan cosas distintas en el negocio. `Transaction` es la única entidad del dominio del SDK, porque es el único concepto que necesita distinguirse por identidad (`gatewayTransactionId`) a lo largo del tiempo, incluso cuando su estado cambia de `PENDING` a `APPROVED` tras un webhook.

**Objeto de valor (Value Object).** Un objeto de valor no tiene identidad propia: dos instancias con los mismos datos son intercambiables. `Amount`, `Currency`, `OrderReference`, `Payer`, `GatewayTransactionId`, `RejectionReason` y `WebhookEvent` son objetos de valor. Se comparan por su contenido, no por una referencia de identidad, y son inmutables por diseño: ninguno expone un método que modifique su propio estado interno.

**Enum de dominio.** `TransactionStatus`, `Gateway`, `RejectionCategory` y `SdkErrorCode` no son ni entidades ni objetos de valor en el sentido estricto: son catálogos cerrados de valores válidos, sin comportamiento propio, usados para tipar de forma segura conceptos que de otro modo serían strings sueltos propensos a error de tipeo.

**Servicio de dominio.** Cuando una operación de negocio no pertenece naturalmente a ninguna entidad ni objeto de valor específico, se modela como un servicio de dominio sin estado propio. `WebhookVerifier` es el ejemplo: verificar una firma criptográfica no es responsabilidad de `Transaction` ni de ningún objeto de valor, así que vive como un servicio independiente en `domain/services/`.

**Excepción de dominio.** `SdkError` es la única forma en que el dominio comunica un fallo no recuperable hacia el exterior. En lugar de dejar que las excepciones nativas de `fetch`, `axios` o cualquier librería HTTP se propaguen sin control hacia el desarrollador que consume el SDK, todo error se envuelve en `SdkError`, con un código tipado, la pasarela de origen y el payload original preservado para depuración.

### 4. Patrones de diseño GoF empleados

Sobre la base hexagonal y de DDD, el proyecto usa tres patrones clásicos del catálogo Gang of Four, cada uno resolviendo un problema puntual:

**Facade.** El patrón Facade oculta la complejidad interna de un subsistema detrás de una interfaz simple. `KitPagos` es el Facade del SDK: el desarrollador que lo consume nunca instancia un adaptador, nunca conoce el `GatewayFactory`, nunca maneja reintentos manualmente. Solo ve tres métodos (`createPayment`, `getPaymentStatus`, `validateWebhook`) y una entidad `Transaction` como resultado.

**Factory.** El patrón Factory centraliza la lógica de creación de objetos cuando esa lógica depende de una condición en tiempo de ejecución. `GatewayFactory` (todavía no implementado, ver sección 6) recibirá el valor del enum `Gateway` configurado por el desarrollador y devolverá la instancia del adaptador correspondiente, sin que el resto del sistema necesite un `switch` o un `if` repartido por varios archivos para saber qué adaptador usar.

**Adapter.** El patrón Adapter (que le da nombre a media arquitectura del proyecto) traduce una interfaz existente hacia la que el cliente espera. Cada `Adapter` de pasarela traducirá el contrato abstracto `PaymentGatewayPort` hacia las llamadas HTTP reales, la autenticación y el formato de payload específico de Wompi, Rapyd, Mercado Pago o Kushki.

### 5. Principio de Inversión de Dependencias (el porqué técnico de todo lo anterior)

Todo lo descrito arriba es, en el fondo, una aplicación disciplinada del Principio de Inversión de Dependencias (la "D" de SOLID): los módulos de alto nivel (el dominio, que contiene las reglas de negocio más importantes del sistema) no deben depender de módulos de bajo nivel (los detalles de cómo Wompi firma un webhook); ambos deben depender de abstracciones (`PaymentGatewayPort`). Es este principio, más que cualquier framework o librería, el que hace posible que el `Response Normalizer` (una vez implementado) pueda tratar a Wompi y a Kushki exactamente igual, a pesar de que Kushki use un vocabulario de estados distinto.

---

## Parte II — Cómo se refleja esto en el código real

### 6. Estado de avance actual, para tener expectativas correctas

Antes de recorrer el código, es importante ser preciso sobre qué existe hoy y qué todavía no. La tabla siguiente resume el estado real de cada capa, verificado directamente contra `sdk/src/`:

| Capa | Carpeta | Estado |
|---|---|---|
| Dominio | `domain/entities/`, `domain/value-objects/`, `domain/errors/`, `domain/services/` | **Implementado.** Todas las clases y tipos descritos en la Parte I existen como archivos reales, con su lógica de validación e invariantes funcionando (ver secciones 7 a 9). |
| Aplicación (puertos) | `application/ports/` | **Implementado.** El contrato `PaymentGatewayPort` existe y está completo (sección 10). |
| Aplicación (servicios) | `application/services/` | **No existe todavía.** `ResponseNormalizer`, `RetryHandler` y `ErrorHandler` están descritos en `layers-and-components.md` pero no tienen ningún archivo creado. |
| Infraestructura (facade) | `infrastructure/facade/` | **Esqueleto.** `KitPagos.ts` existe con la forma correcta (nombres de método, tipos de entrada y salida) pero cada método lanza un error indicando que no está implementado (sección 11). |
| Infraestructura (config, factories, adapters) | `infrastructure/config/`, `infrastructure/factories/`, `infrastructure/adapters/` | **No existe todavía.** Ningún adaptador de pasarela, el `SDKConfigurator` ni el `GatewayFactory` tienen archivo creado. |
| API de Simulación | `simulator-api/src/` | **Solo scaffolding.** `server.ts` está vacío y las carpetas `routes/`, `scenarios/`, `types/` solo contienen un `.gitkeep`. |

Esto no es un problema, es el punto exacto en el que está el proyecto en esta etapa: la arquitectura hexagonal ya se decidió y ya se construyó su parte más difícil de acertar (el núcleo de dominio y el contrato del puerto), que es precisamente la parte que después es costosa de cambiar. Lo que falta es más volumen de trabajo que complejidad de diseño nuevo.

### 7. Recorrido por el dominio: `Transaction`, la única entidad

El archivo `sdk/src/domain/entities/Transaction.ts` es el mejor punto de partida porque concentra casi todos los conceptos de la Parte I en un solo lugar:

```typescript
export class Transaction {
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

  getStatus(): TransactionStatus {
    return this.status;
  }

  isApproved(): boolean {
    return this.status === "APPROVED";
  }

  isPending(): boolean {
    return this.status === "PENDING";
  }

  isFinal(): boolean {
    return this.status !== "PENDING";
  }
}
```

Tres decisiones de la Parte I se ven directamente en este fragmento. Primero, **la identidad**: el primer campo del constructor es `gatewayTransactionId`, un objeto de valor propio (no un `string` suelto), y es lo que distingue a esta entidad de cualquier otra transacción, incluso si dos transacciones tuvieran el mismo monto y el mismo pagador. Segundo, **la inmutabilidad radical**: todos los campos son `readonly`, no existe ningún método `setStatus()` o `updateStatus()`; cuando una transacción `PENDING` se concilie mediante un webhook, el código que la reciba tendrá que construir una instancia `Transaction` completamente nueva en lugar de mutar la existente. Tercero, **el encapsulamiento de comportamiento de negocio**: en lugar de que el código que consume el SDK compare `transaction.getStatus() === "APPROVED"` en veinte lugares distintos de su aplicación, el dominio expone `isApproved()`, `isPending()` e `isFinal()`, de modo que esa regla de negocio vive en un solo sitio.

Nótese también que ningún tipo importado en este archivo (`Amount`, `Currency`, `OrderReference`, `Payer`, `GatewayTransactionId`, `RejectionReason`, `TransactionStatus`) proviene de fuera de `domain/`. Esa es la regla de dependencia de la sección 2 cumpliéndose de forma verificable: se puede confirmar ejecutando una búsqueda de importaciones dentro de la carpeta de dominio y comprobando que ninguna apunta a `application/` o `infrastructure/` (ver sección 12 para el comando exacto).

### 8. Objetos de valor: inmutabilidad e invariantes con validación propia

Los objetos de valor no son simples contenedores de datos; cada uno protege sus propias reglas de validez en el constructor, de forma que sea imposible construir una instancia inválida en ningún punto del sistema. `Amount` es el ejemplo más claro:

```typescript
export class Amount {
  private readonly value: number;

  constructor(value: number) {
    if (Math.round(value * 100) !== value * 100) {
      throw new Error("Amount solo admite hasta dos decimales significativos");
    }
    if (value < 0) {
      throw new Error("Amount no puede ser negativo");
    }
    this.value = value;
  }

  getValue(): number {
    return this.value;
  }

  toMinorUnits(): number {
    return Math.round(this.value * 100);
  }

  equals(other: Amount): boolean {
    return this.value === other.value;
  }
}
```

El valor interno (`value`) es privado, así que la única forma de crear un `Amount` es pasando por el constructor, que rechaza montos negativos o con más de dos decimales antes de que ese dato inválido pueda propagarse a cualquier otro componente. El método `toMinorUnits()` existe porque casi todas las pasarelas (empezando por Wompi) reciben el monto en la unidad menor de la divisa (centavos) como entero, no en pesos con decimales; en lugar de que cada adaptador reimplemente esa multiplicación por cien, la conversión vive una sola vez aquí. Y `equals()` es la manifestación concreta de "los objetos de valor se comparan por contenido, no por identidad": dos instancias de `Amount` con el mismo `value` son iguales para el dominio, aunque sean dos objetos distintos en memoria de JavaScript.

Los enums del dominio, en cambio, no necesitan clase ni validación propia porque TypeScript ya garantiza en tiempo de compilación que solo se puedan usar los valores listados. `Gateway` es el ejemplo más pequeño:

```typescript
export enum Gateway {
  WOMPI = "WOMPI",
  PAYU = "PAYU",
  MERCADOPAGO = "MERCADOPAGO",
  KUSHKI = "KUSHKI",
}
```

y `TransactionStatus` sigue el mismo patrón con sus seis valores posibles (`APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`). Cualquier intento de asignar `"aprobado"` o `"Approved"` a una variable tipada como `TransactionStatus` falla en la compilación, no en tiempo de ejecución. El uso de `enum` con valores string en lugar de `type` alias permite además referenciar los valores como constantes con nombre (por ejemplo `Gateway.WOMPI`) en sentencias `switch`/`case` y comparaciones en tiempo de ejecución.

### 9. `SdkError` y `WebhookEvent`: el dominio comunicándose hacia afuera sin exponer sus detalles internos

`SdkError` es la excepción unificada mencionada en la sección 3:

```typescript
export class SdkError extends Error {
  constructor(
    public readonly code: SdkErrorCode,
    public readonly gateway: Gateway,
    public readonly originalPayload: unknown,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "SdkError";
  }
}
```

El detalle más importante aquí, desde el punto de vista arquitectónico, es el tipo de `originalPayload`: es `unknown`, no `any`. Esto es intencional: `unknown` obliga a cualquier código que quiera leer ese payload a hacer primero una verificación de tipo explícita, en lugar de asumir silenciosamente una forma que podría no cumplirse. Es una decisión pequeña de tipado que evita una clase entera de errores en tiempo de ejecución más adelante, cuando el `ErrorHandler` empiece a inspeccionar `originalPayload` para distinguir errores transitorios de definitivos.

`WebhookEvent`, por su parte, es el objeto de valor que resuelve una brecha real que existía entre el requisito funcional RF-04 ("validar la firma de un webhook y retornar un evento normalizado") y el resto del modelo de dominio, que hasta la corrección de inconsistencias de esta misma semana no tenía ningún concepto que representara ese "evento normalizado":

```typescript
export interface WebhookEventAttributes {
  eventType: string;
  gatewayTransactionId: string;
  newStatus: TransactionStatus;
  gateway: Gateway;
}

export class WebhookEvent {
  public readonly eventType: string;
  public readonly gatewayTransactionId: string;
  public readonly newStatus: TransactionStatus;
  public readonly gateway: Gateway;

  constructor(attributes: WebhookEventAttributes) {
    this.eventType = attributes.eventType;
    this.gatewayTransactionId = attributes.gatewayTransactionId;
    this.newStatus = attributes.newStatus;
    this.gateway = attributes.gateway;
  }
}
```

Nótese que `newStatus` está tipado como `TransactionStatus`, el mismo enum del dominio usado por `Transaction`. Esta reutilización no es casualidad: es lo que le permite al futuro `ResponseNormalizer` reconciliar una transacción `PENDING` existente con el estado que llega en un webhook, sin necesitar una tabla de conversión adicional entre "el vocabulario de los webhooks" y "el vocabulario de las transacciones", porque son literalmente el mismo tipo.

### 10. El puerto: la frontera exacta entre el dominio y el mundo exterior

`PaymentGatewayPort.ts`, en `application/ports/`, es probablemente el archivo más importante del proyecto desde el punto de vista arquitectónico, porque es el único lugar donde queda escrita la frontera entre "lo que el dominio necesita que exista" y "cómo se implementa realmente":

```typescript
export interface CreatePaymentRequest {
  amount: Amount;
  currency: Currency;
  orderReference: OrderReference;
  payer: Payer;
  returnUrlConfig?: ReturnUrlConfig;
}

export interface PaymentGatewayPort {
  createPayment(request: CreatePaymentRequest): Promise<Transaction>;

  getStatus(gatewayTransactionId: string): Promise<Transaction>;

  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean;
}
```

Fíjense en lo que este archivo *no* contiene: no hay ninguna mención a HTTP, a `fetch`, a `axios`, a un endpoint, a un formato de JSON, ni a ninguna de las cuatro pasarelas por nombre. `CreatePaymentRequest` y el método `createPayment()` solo hablan en términos de objetos de valor del dominio (`Amount`, `Currency`, `OrderReference`, `Payer`). Esto es deliberado: cuando `WompiAdapter implements PaymentGatewayPort` se escriba, ese archivo sí va a tener `fetch` y URLs de Wompi, pero todo ese detalle queda encapsulado detrás de esta interfaz, y ni `KitPagos` ni ningún otro componente que dependa del puerto necesita saber que existe.

Este archivo es también donde vive, hoy, la única inconsistencia de nombres pendiente de decidir en el propio puerto: sus métodos se llaman `getStatus()` y `verifySignature()`, mientras que el facade público (`KitPagos`, sección 11) expone `getPaymentStatus()` y `validateWebhook()`. Esto no es un error, es intencional: el puerto describe el contrato interno que cada adaptador debe cumplir, mientras que el facade describe la API pública que ve el desarrollador externo, y ambos nombres no tienen por qué coincidir. Aun así, vale la pena que quien implemente el primer adaptador confirme esta decisión explícitamente, para no terminar con tres nombres distintos para la misma operación conforme se agreguen más componentes.

### 11. El facade: la forma pública ya está fijada, la implementación todavía no

`KitPagos.ts`, en `infrastructure/facade/`, es el único archivo del proyecto pensado para ser importado directamente por el desarrollador que instala el paquete npm:

```typescript
export class KitPagos {
  async createPayment(request: CreatePaymentRequest): Promise<Transaction> {
    throw new Error("KitPagos.createPayment aun no esta implementado");
  }

  async getPaymentStatus(id: string): Promise<Transaction> {
    throw new Error("KitPagos.getPaymentStatus aun no esta implementado");
  }

  validateWebhook(
    payload: string,
    headers: Record<string, string>,
  ): WebhookEvent {
    throw new Error("KitPagos.validateWebhook aun no esta implementado");
  }
}
```

Este archivo ilustra con mucha claridad la diferencia entre "diseñar la arquitectura" y "construir el sistema": la firma pública del SDK, es decir, exactamente los tres métodos que un desarrollador externo va a poder llamar, sus parámetros y sus tipos de retorno, ya está decidida y fijada en código, incluso antes de que exista una sola línea de lógica real detrás. Esto tiene una ventaja práctica concreta: cualquier código de ejemplo, cualquier prueba de integración, o incluso la documentación pública del SDK, se puede empezar a escribir contra esta interfaz ahora mismo, sin esperar a que `WompiAdapter` exista, porque el contrato con el que interactúa el mundo exterior no va a cambiar cuando se implemente la lógica interna.

Lo que falta dentro de cada método, conforme a la Parte I, es la orquestación descrita para el patrón Facade: consultar al `SDKConfigurator` (todavía no implementado) para saber cuál es la pasarela activa y sus credenciales, pedirle al `GatewayFactory` (todavía no implementado) la instancia del adaptador correspondiente a esa pasarela, envolver la llamada al adaptador con el `RetryHandler` (todavía no implementado) para tolerar fallas transitorias de red, y finalmente devolver la `Transaction` o `WebhookEvent` resultante, o convertir cualquier fallo en un `SdkError` a través del `ErrorHandler` (todavía no implementado).

### 12. Cómo verificar la regla de dependencia con tus propias manos

No hay que confiar ciegamente en que "el dominio no depende de la infraestructura": se puede comprobar en segundos. Parado en la raíz del repositorio, este comando busca cualquier importación dentro de `sdk/src/domain/` que apunte hacia `application/` o `infrastructure/`:

```bash
grep -rn "from \"\.\./\.\./application\|from \"\.\./\.\./infrastructure" sdk/src/domain/
```

A la fecha de este documento, ese comando no devuelve ningún resultado, lo cual confirma en la práctica lo que la Parte I describe en la teoría. Vale la pena volver a correr este mismo comando cada vez que se agregue un archivo nuevo al dominio: si alguna vez empieza a devolver resultados, es la señal más temprana posible de que la arquitectura hexagonal se está rompiendo silenciosamente, mucho antes de que ese problema se note de cualquier otra forma.

Un segundo comando útil verifica el sentido contrario: que la capa de aplicación (`application/ports/`) tampoco importe nada de infraestructura, lo cual es necesario para que un puerto siga siendo una abstracción neutral:

```bash
grep -rn "from \"\.\./\.\./infrastructure" sdk/src/application/
```

También devuelve vacío hoy. El día en que exista `application/services/ResponseNormalizer.ts`, este mismo comando debería seguir devolviendo vacío una vez ese archivo se agregue.

### 13. Dónde va a encajar cada pieza que falta

Para que este documento sirva también como mapa de trabajo pendiente, esta tabla conecta cada componente descrito conceptualmente en `layers-and-components.md` con la carpeta exacta donde debe crearse el archivo, y con el patrón o principio de la Parte I que justifica su existencia:

| Componente pendiente | Ruta del archivo (a crear) | Patrón / principio que lo justifica |
|---|---|---|
| `SDKConfigurator` | `infrastructure/config/SDKConfigurator.ts` | Punto único de configuración; permite que `KitPagos` no conozca cómo se resuelven las credenciales |
| `GatewayFactory` | `infrastructure/factories/GatewayFactory.ts` | Patrón GoF Factory (sección 4) |
| `WompiAdapter`, `RapydAdapter`, `MercadoPagoAdapter`, `KushkiAdapter` | `infrastructure/adapters/*.ts` | Patrón GoF Adapter (sección 4), implementan `PaymentGatewayPort` (sección 10) |
| `ResponseNormalizer` | `application/services/ResponseNormalizer.ts` | Traduce el resultado de cualquier Adapter al vocabulario común del dominio (`TransactionStatus`) |
| `RetryHandler` | `application/services/RetryHandler.ts` | Orquesta reintentos entre el Facade y el Adapter, sin que ninguno de los dos conozca al otro directamente |
| `ErrorHandler` | `application/services/ErrorHandler.ts` | Construye instancias de `SdkError` (sección 9) a partir de fallos técnicos crudos |

Cada una de estas piezas, cuando se implemente, debería poder explicarse con la misma estructura usada en la Parte II de este documento: qué problema resuelve, qué patrón aplica, y cómo se puede verificar en el código que efectivamente respeta la regla de dependencia de la Arquitectura Hexagonal.

---

## 14. Documentos relacionados

- [`layers-and-components.md`](./layers-and-components.md): especificación oficial de cada componente (Nivel 3 del modelo C4), incluyendo los que todavía no existen como archivo.
- [`ubiquitous-language.md`](./ubiquitous-language.md): tabla de equivalencias exactas entre el modelo normalizado del SDK y el formato nativo de cada pasarela, necesaria para implementar cada `Adapter`.
- [`sad-inconsistencies.md`](./sad-inconsistencies.md): registro de discrepancias detectadas entre el SAD, sus diagramas y el código, incluyendo las dos decisiones de nombres mencionadas en las secciones 10 y 11 de este documento.
- [`setup-and-structure.md`](./setup-and-structure.md): decisiones de configuración del entorno de desarrollo (TypeScript, Jest, Fastify) que no son parte de la arquitectura en sí, pero condicionan cómo se prueba y se ejecuta el código descrito aquí.

---

*Documento técnico del proyecto Kit Pagos Colombia. Pontificia Universidad Javeriana, 2026.*
