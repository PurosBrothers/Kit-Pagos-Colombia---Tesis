# Ejemplo ejecutable: intercambiabilidad de las cuatro pasarelas

Archivo: `examples/gateway-interchangeability.ts`. Cierra el issue #58 y con él la Iteración 2.

## Qué demuestra

Que el mismo pago, descrito una sola vez con objetos de dominio, se cobra por Wompi, Rapyd,
Mercado Pago y Kushki sin que cambie una línea del código del comercio, y que las cuatro
devuelven el mismo resultado normalizado.

Los otros cuatro ejemplos de la carpeta muestran cada pasarela por separado. Este muestra lo que
ninguno puede mostrar solo, porque la intercambiabilidad no es una propiedad de una pasarela sino
de la relación entre las cuatro.

Es el argumento central de la tesis convertido en algo que se ejecuta. También es insumo directo
del prototipo de la Fase 5 descrito en `docs/project-management/prototypes-evaluation-plan.md`: la
variable "conceptos nativos expuestos" se mide sobre código como este.

## Cómo correrlo

```bash
# 1. Compilar el SDK, porque el paquete de ejemplos apunta a dist/
cd sdk && npm install && npm run build

# 2. Levantar la API de Simulación y dejarla corriendo
cd simulator-api && npm install && npm run dev

# 3. En otra terminal
cd examples && npm install && npm run simulate:interchangeability
```

## Lo que el desarrollador escribe

El pago se describe una vez:

```ts
const pago: CreatePaymentRequest = {
  amount: new Amount("150000.00"),
  currency: new Currency("COP"),
  orderReference: new OrderReference(`ORDER-INTERCAMBIO-${Date.now()}`),
  payer: new Payer({ email: "jaime.pavlich@example.com", fullName: "Jaime Pavlich" }),
};
```

Y se cobra cuatro veces, cambiando un valor:

```ts
for (const pasarela of PASARELAS) {
  const kitPagos = new KitPagos({
    gateway: pasarela,
    credentials: CREDENCIALES,
    baseUrl: ENDPOINTS_SIMULADOR[pasarela],
  });

  const resultado = await kitPagos.createPayment(pago);
  // ...
}
```

No aparece ningún concepto nativo: ni `amount_in_cents` de Wompi, ni la firma HMAC de Rapyd, ni
`transaction_amount` de Mercado Pago, ni el objeto `amount` descompuesto por impuesto de Kushki.

**El ejemplo no tiene ni un condicional por pasarela.** Tiene dos, y ninguno discrimina pasarelas:
los dos son ramas del contrato, y estarían igual con una sola pasarela. El primero es la forma del
resultado, porque `createPayment()` devuelve o una transacción o una redirección pendiente (issue
 #64) y el compilador no permite leer la transacción hasta que se descarta la redirección. El
segundo es si el estado ya es definitivo, con `transaction.isFinal()`.

El segundo `if` apareció al implementar el cobro con tarjeta, y lo que absorbe es que **el número
de llamadas necesarias no es el mismo en las cuatro**: una para Mercado Pago y Kushki, que traen el
desenlace en el cuerpo del `POST`; dos para Wompi, que crea la transacción en `PENDING` y la
resuelve después; tres para Rapyd, que además redirige. El comercio escribe el caso de tres
llamadas y le sirve para las cuatro, que es la forma en que la diferencia queda absorbida en vez de
esconderse.

## La salida

```text
Pasarela      Estado normalizado  Estado nativo  Monto          ID en la pasarela
──────────────────────────────────────────────────────────────────────────────────────
WOMPI         APPROVED            APPROVED       150000.00 COP  7b3417c7-47d5-4f12-...
RAPYD         APPROVED            CLO            150000.00 COP  payment_e5097603a3f0...
MERCADOPAGO   APPROVED            approved       150000 COP     8388481045
KUSHKI        APPROVED            APPROVAL       150000 COP     bea2f927a07d474b84
```

La columna que importa es la del estado nativo, porque es la que cambia: `APPROVED`, `CLO`,
`approved` y `APPROVAL` son la misma cosa dicha de cuatro formas, y una de ellas (`CLO`) no
significa "pagado" sino "cerrado". La columna del estado normalizado es la que el comercio
programa contra, y es una sola.

## La verificación no es visual

El ejemplo termina comparando por código que las cuatro transacciones coinciden en tres cosas, y
sale con código distinto de cero si alguna no coincide:

1. **Estado normalizado.** Lo que el issue #58 exige.
2. **Monto**, comparado con `Amount.equals()` y no con `===` sobre la cadena. Es necesario:
   Wompi y Rapyd devuelven `150000.00` y Mercado Pago y Kushki `150000`. Son el mismo monto
   escrito con distinta escala, y comparar cadenas produciría un fallo que no es un fallo. Se ve
   en la tabla de arriba.
3. **Referencia de la orden.** No lo pedía el issue, pero es la que el comercio usa para
   conciliar: una pasarela que devuelve otra referencia rompe la conciliación aunque el estado y
   el monto coincidan. Es exactamente el defecto que tenía Kushki, documentado en el punto 41 del
   `architecture-log.md`, y por eso queda fijado también acá y no solo en una prueba unitaria.

Comprobado rompiendo a mano el mapeo de `APPROVAL` en `KushkiResponseNormalizer` para que
devolviera `PENDING`: el ejemplo salió con código 1 e imprimió

```text
=== La intercambiabilidad está rota ===

  - KUSHKI normalizó el estado como PENDING y WOMPI como APPROVED.
```

## Límites conocidos de esta demostración

Son del simulador, no del SDK, y conviene tenerlos presentes al leer la salida.

- **`baseUrl` cambia por pasarela.** `SDKOptions.baseUrl` es un override escalar cuya razón de
  ser es apuntar el SDK al simulador sin tocar código (RF-09). El simulador expone una ruta
  distinta por pasarela, así que el ejemplo mantiene una tabla de endpoints indexada por
  `Gateway`. **En producción esa tabla desaparece** y lo único que cambia es `gateway`, porque
  cada adaptador conoce la URL real de su pasarela. Es una tabla de datos, no una cadena de
  condicionales: agregar una quinta pasarela es agregar una fila.
- **Las credenciales se declaran una sola vez.** `SDKOptions.credentials` es un mapa por
  pasarela, así que el comercio registra las cuatro y el SDK usa las de la activa. No hace falta
  reconfigurar credenciales al cambiar de pasarela.
- **El ejemplo consulta el estado solo cuando hace falta**, no siempre. Consultar de más traería
  una limitación del mock a una comparación que quiere hablar del SDK. Las consultas que sí hace
  —Wompi y Rapyd— devuelven la referencia y el monto del pago creado, así que entran en la
  comparación sin distorsionarla.

## Lo que este ejemplo todavía no puede demostrar

PSE. La rama `REDIRECT_REQUIRED` del resultado ya se alcanza, pero por tarjeta y en una sola
pasarela: Rapyd cobra la tarjeta en su propia página alojada, para dejar el servidor del comercio
fuera del alcance de PCI DSS. Con PSE redirigen las cuatro, y ahí aparece el problema que el punto
 39 dejó abierto: el número de llamadas previas a la redirección varía por pasarela (Wompi 1,
Mercado Pago 1, Rapyd 2, Kushki 3), y el puerto sigue asumiendo una sola.

Este ejemplo quedó escrito antes de que el cobro con tarjeta se midiera contra los sandboxes
reales, y lo que creía sobre la tarjeta resultó falso en dos puntos: daba por hecho que las cuatro
resolvían en la respuesta del `POST`, y describía el pago sin token de tarjeta, que ninguna de las
cuatro acepta de verdad. Las dos cosas pasaban el `typecheck`, así que lo que las encontró fue
ejecutarlo. Está en los puntos 50 y 51 del [`architecture-log.md`](../architecture/architecture-log.md).
