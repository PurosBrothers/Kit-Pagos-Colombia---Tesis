# La arquitectura hexagonal en el código real

El documento anterior explicó la teoría. Este la verifica contra el código que hay hoy en `sdk/src`, con fragmentos reales y con los comandos para que cualquiera compruebe las afirmaciones en su propia máquina en lugar de creerlas.

Todo lo que sigue corresponde a la rama `devops` y a las **61 unidades de producción** de `sdk/src` (más 35 archivos de prueba). Cuando algo esté pendiente, se dice; este documento reemplaza a una versión anterior que describía un SDK esqueleto —métodos que lanzaban "aún no está implementado", un solo adaptador, el monto como `number`— y era la fuente de confusión más grande de la documentación.

---

## 1. Las tres capas son tres carpetas

```text
sdk/src/
├── domain/            29 archivos   el núcleo: reglas de negocio puras
├── application/       13 archivos   el puerto y los servicios de orquestación
├── infrastructure/    17 archivos   los adaptadores y la fachada
├── index.ts                         la superficie pública del paquete
└── test-support/                    ayudas usadas solo por las pruebas
```

No es una convención de nombres: la regla de dependencia se cumple en esa dirección y se puede comprobar.

---

## 2. Comprobar la regla de dependencia

Estos dos comandos son la verificación. Si la arquitectura se rompiera, dejarían de estar vacíos.

```bash
cd sdk

# 1. ¿El dominio importa algo de aplicación o de infraestructura?
grep -rn 'from "\.\..*\(infrastructure\|application\)' src/domain --include='*.ts' \
  | grep -v '\.test\.ts'

# 2. ¿La aplicación importa algo de infraestructura?
grep -rn 'from "\.\..*infrastructure' src/application --include='*.ts'
```

Los dos salen sin resultados. **Con una excepción honesta**, que es la razón del `grep -v` del primero: `src/domain/services/WebhookVerifier.test.ts` importa un servicio de aplicación para armar su escenario de prueba. Es código de prueba, no de producción, y no entra en el paquete publicado, pero conviene decirlo en lugar de esconderlo detrás de un filtro sin explicar.

### La otra verificación: las dependencias externas están aisladas

```bash
# ¿Quién importa big.js?
grep -rln 'from "big.js"' src/
# -> src/domain/value-objects/big-arithmetic.ts, y nada más

# ¿Quién importa crypto en el dominio?
grep -rln 'from "crypto"\|from "node:crypto"' src/domain/ | grep -v '\.test\.ts'
# -> src/domain/services/webhooks/signature-utils.ts, y nada más
```

**`big.js` tiene exactamente un importador en todo el SDK.** Es la única dependencia de producción del paquete, y está confinada a un módulo de aritmética que solo opera sobre cadenas. Si algún día hay que cambiar de librería decimal, hay un archivo que cambia.

**`crypto` aparece en cuatro archivos de producción, y la distinción importa.** En el dominio, solo en `signature-utils.ts`, que es donde vive toda la verificación de firmas de webhook: la comparación en tiempo constante, el SHA-256 y el HMAC. Los otros tres están en la capa de infraestructura y son para firmar lo que **sale** hacia una pasarela concreta: la firma de integridad de Wompi, la firma por petición de Rapyd y el UUID de idempotencia de Mercado Pago. Eso es detalle de cable de un proveedor específico, así que está bien que viva en su adaptador y no en el núcleo.

La consecuencia práctica es la que importa: **para auditar que todas las verificaciones de firma son en tiempo constante hay que leer un archivo**, no cuatro.

---

## 3. El dominio, con el código a la vista

### `Amount` guarda texto, y rechaza `number` en la firma

```10:47:sdk/src/domain/value-objects/Amount.ts
  private static readonly MAX_SCALE = 2;

  private readonly value: string;

  constructor(value: string) {
    if (typeof value !== "string") {
      throw new Error("Amount debe recibir el monto como string, no como number");
    }
    if (value.startsWith("-")) {
      throw new Error("Amount no puede ser negativo");
    }
    if (!isCanonicalAmount(value)) {
      throw new Error(/* ... */);
    }
    this.value = value;
  }
```

La comprobación explícita de `typeof value !== "string"` existe porque el SDK se publica en npm y lo puede consumir JavaScript sin tipos, donde el compilador no defiende nada. Y aceptar `number` "por comodidad" reabriría exactamente el problema que la clase resuelve: el cero final de `"19.90"` que Rapyd necesita para que su firma HMAC coincida.

Tres propiedades que este diseño garantiza y que conviene notar: valida en el constructor, así que **si un `Amount` existe, es válido**; no expone ningún método que modifique su estado, así que no hay forma de que deje de serlo; y la conversión a unidad menor corre el punto decimal sobre el texto en lugar de multiplicar por cien.

### `PaymentResult` es una unión discriminada, y el compilador la hace cumplir

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

Esto es más que una decisión de estilo. Con este tipo, el código del comercio **no compila** si lee la transacción sin haber distinguido primero el caso:

```ts
const resultado = await kit.createPayment({ /* ... */ });

// Esto no compila: la propiedad transaction no existe en la rama de redirección.
console.log(resultado.transaction.getStatus());

// Esto sí, y es la única forma:
if (resultado.outcome === "REDIRECT_REQUIRED") {
  return redirigir(resultado.redirect.redirectUrl);
}
console.log(resultado.transaction.getStatus());
```

La alternativa era una `Transaction` con un campo `redirectUrl` opcional. Habría compilado igual olvidándose de la redirección, y el defecto habría aparecido en producción como un pago de PSE que nunca avanza. Con la unión, olvidarse es un error de compilación.

### La excepción del dominio conserva el rastro

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

Tres cosas juntas: un **código tipado** para que el comercio programe contra un catálogo cerrado y no contra textos de mensaje; la **pasarela de origen**, que con cuatro adaptadores es la primera pregunta al depurar; y el **payload original**, porque ningún catálogo de errores va a cubrir todo y cuando hay que escribirle al soporte de la pasarela hace falta lo que ella dijo, literal.

> La clase se llamaba `SdkError` y su enum `SdkErrorCode`. Se renombraron a `KitPagosError` y `KitPagosErrorCode`. Varios documentos viejos todavía usaban el nombre anterior; si aparece en alguna parte, es una referencia obsoleta.

### El resto del dominio

| Carpeta | Contenido |
|---|---|
| `entities/` | `Transaction`, la única entidad |
| `value-objects/` | 20 archivos: el monto y sus dos costuras (`big-arithmetic.ts`, `minor-units.ts`), divisa, referencia, pagador, identificador nativo, razón y categoría de rechazo, URLs de retorno, desglose de IVA, método de pago, banco PSE, credenciales, el resultado de pago, el evento de webhook y los enums |
| `services/` | `WebhookVerifier` como despachador, `native-status.ts` con las tablas de estado nativo, y `webhooks/` con una implementación por pasarela más `signature-utils.ts` |
| `errors/` | `KitPagosError` |

**Las tablas de estado nativo están en el dominio y eso puede sorprender**, porque los textos `"APPROVED"`, `"APPROVAL"` y `"CLO"` son vocabulario de un proveedor. Viven ahí porque **el significado** de esos textos es una regla de negocio: decidir que `CLO` con `paid: true` es una aprobación y que `CLO` a secas no lo es no es un detalle de transporte, es la definición de qué cuenta como pago exitoso. Lo que sí está en infraestructura es cómo se extrae ese texto del cuerpo HTTP de cada pasarela.

---

## 4. La aplicación: el puerto y los tres servicios

El puerto es el contrato completo del proyecto, y son cuatro operaciones:

```21:32:sdk/src/application/ports/PaymentGatewayPort.ts
export interface PaymentGatewayPort {
  createPayment(request: CreatePaymentRequest): Promise<PaymentResult>;
  getStatus(gatewayTransactionId: string): Promise<Transaction>;
  getPseBanks(): Promise<PseBank[]>;
  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean;
}
```

Lo notable es lo que **no** aparece: ni una mención de HTTP, de un header, de un formato de cuerpo ni del nombre de una pasarela. Todos los tipos que entran y salen son del dominio. Ese es el punto exacto en que la arquitectura hexagonal se vuelve concreta: este archivo es la frontera, y de un lado nadie sabe que del otro hay red.

Los tres servicios de aplicación:

- **`ResponseNormalizer`** despacha a una implementación por pasarela en `normalizers/`. Traduce la respuesta cruda a una `Transaction`. Fue un solo método de 360 líneas con un `switch`, y se dividió (punto 34).
- **`RetryHandler`** reintenta con retroceso exponencial y fluctuación, **solo** las operaciones idempotentes.
- **`ErrorHandler`** traduce fallos a `KitPagosError`, y está dividido **por forma del error y no por pasarela**: un timeout es un timeout en las cuatro, y dividirlo por proveedor habría producido cuatro copias de la misma lógica.

---

## 5. La infraestructura: adaptadores y fachada

| Componente | Archivos |
|---|---|
| Fachada | `facade/KitPagos.ts` |
| Configuración | `config/SDKConfigurator.ts` |
| Factoría | `factories/GatewayFactory.ts` |
| Adaptadores | Cuatro clases más nueve módulos auxiliares |

Los nueve módulos auxiliares merecen una explicación, porque son casi la mitad de la capa. Cada uno salió de que un adaptador crecía demasiado: `wompi-pse.ts`, `mercadopago-pse.ts`, `kushki-pse.ts` y `rapyd-pse.ts` tienen el flujo de PSE de su pasarela, que es el más complejo; `rapyd-signature.ts` y `rapyd-checkout.ts` separan la firma por petición y el checkout alojado; `kushki-charge.ts` y `kushki-amount.ts` separan el cobro con tarjeta y el objeto de desglose de IVA; y `payment-method-support.ts` es la guarda compartida que rechaza métodos no soportados.

Extraerlos no fue solo estética: **es lo que mantiene a las clases de adaptador por debajo de los umbrales de métricas CK**. Un adaptador con todo adentro rompía el umbral de complejidad, y el módulo extraído es además probable por separado, sin montar una respuesta HTTP falsa completa.

---

## 6. La superficie pública

`src/index.ts` es lo que se exporta, y funciona como una frontera adicional: lo que no está ahí, el comercio no lo puede usar aunque exista.

Tiene una prueba de fuego permanente: el paquete de `examples/` consume el SDK **por su nombre público** (`import { ... } from "kit-pagos-colombia"`), nunca por rutas relativas hacia `src/`. Así, cualquier tipo que falte en la superficie rompe la compilación de los ejemplos de inmediato. Fue así como se descubrió que faltaban cuatro tipos exportados (punto 21), y es la razón por la cual `cd examples && npm run typecheck` es parte de la verificación obligatoria.

---

## 7. Qué está pendiente

Para que este documento no repita el error del que reemplazó, la lista de lo que **no** está terminado:

- **El motor de escenarios de la API de Simulación solo sabe aprobar**, y solo para Wompi. Falta rechazo, fondos insuficientes, timeout y error de red. Es el primer entregable de la Iteración 3.
- **El script de métricas CK tiene la ruta fija contra `sdk/src`**, así que todavía no se puede correr sobre los prototipos de la Fase 5.
- **Los dos proyectos prototípicos no existen** como código; existe su diseño experimental.
- **La API de Simulación no está desplegada.**

---

## 8. Qué sigue

El segundo componente: [3-api-de-simulacion.md](3-api-de-simulacion.md). Y para el recorrido detallado del SDK, [03-sdk/1-recorrido-de-una-llamada.md](../03-sdk/1-recorrido-de-una-llamada.md).
