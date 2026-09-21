# La demo interactiva

`examples/interactive-demo.ts` recorre un pago completo preguntando por consola qué
pasarela, qué método y con qué datos, y en cada paso imprime **la petición que
realmente salió y la respuesta que realmente llegó**.

Los otros diez ejemplos muestran *que* el SDK funciona. Este muestra *qué está
haciendo*, y es el artefacto pensado para la sustentación.

## Por qué hace falta un ejemplo más

La afirmación central del trabajo es que el SDK normaliza cuatro pasarelas
heterogéneas detrás de un mismo puerto. Hasta acá esa afirmación se podía verificar
de dos maneras: leyendo los cuatro adaptadores, o creyéndole a la documentación de
arquitectura.

Ninguna de las dos sirve para mostrarle el trabajo a alguien en diez minutos. Y la
segunda tiene un problema peor: una documentación que *describe* lo que el código
envía se desincroniza a la primera refactorización, y a partir de ahí miente con
mucha seguridad. Ya pasó una vez en este repositorio, con los diez fragmentos del
README que dejaron de compilar (punto 21 del [`architecture-log.md`](../architecture/architecture-log.md)).

La demo evita las dos cosas: la normalización se vuelve **observable**, y no hay
nada escrito a mano que se pueda desincronizar.

## Cómo correrla

Necesita la API de Simulación arriba:

```bash
cd simulator-api && npm run dev
```

En otra terminal:

```bash
cd examples && npm run demo
```

También acepta las respuestas como argumentos, y entonces no pregunta nada:

```bash
npm run demo -- wompi tarjeta
npm run demo -- mercadopago pse
```

Los argumentos son las respuestas en el orden en que se habrían tecleado, y cada
opción se puede dar por número o por parte del nombre. Lo que no se informa toma el
valor por omisión.

Ese segundo modo no es un atajo para las pruebas: es lo que hace que la demo se
pueda **ejecutar** de forma reproducible y no solo compilar. Una demo interactiva
que nadie puede correr sin tipear es una demo que se rompe sin que nadie se entere.

## Cómo observa las peticiones sin saber de pasarelas

Este es el punto de diseño que decide si la demo sirve o estorba.

El requisito es imprimir lo que de verdad viajó, y al mismo tiempo **no tener
conocimiento de pasarelas propio**: ni un `switch` sobre `Gateway` con detalles de
cada API, porque eso duplicaría en `examples/` lo que vive en
`sdk/src/infrastructure/adapters/` y las dos copias se separarían.

Las dos cosas a la vez se consiguen con un espía sobre `globalThis.fetch`. Los
cuatro adaptadores llaman al `fetch` global sin importarlo, así que envolverlo los
intercepta a los cuatro por igual:

```typescript
function installNetworkSpy(): void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const response = await originalFetch(...args);

    exchanges.push({
      method: init?.method ?? "GET",
      url: String(input),
      requestBody: typeof init?.body === "string" ? init.body : null,
      status: response.status,
      responseBody: await response.clone().text(),
    });

    return response;
  };
}
```

El espía es agnóstico de pasarela **por construcción**: no menciona ninguna, y
funciona igual con una quinta. Y como imprime bytes en vez de descripciones, si un
adaptador cambia lo que envía, la salida cambia sola. La demo no puede mentir.

El `clone()` no es decorativo: el cuerpo de una `Response` se consume una sola vez,
así que leerlo sin clonar le dejaría al adaptador un cuerpo vacío y la demo rompería
justo lo que vino a observar.

## Qué se ve al correrla

### El mismo monto, dos escalas distintas

Con `150000.00 COP` de monto de dominio, esto es lo que salió por el cable.

Wompi, en dos llamadas —la primera pide el token de aceptación, que es un requisito
suyo y de nadie más:

```
[1] GET  .../wompi/merchants/pub_test_demo_no_real         respondió 200
[2] POST .../wompi/transactions                            respondió 201

  Lo que el adaptador envió:
    {
      "amount_in_cents": 15000000,
      "currency": "COP",
      "reference": "ORDER-DEMO-1790011914806",
      "customer_email": "jaime.pavlich@example.com",
      "payment_method": { "type": "CARD", "token": "tok_demo_no_real", "installments": 1 },
      "acceptance_token": "sim_acceptance_4cc9275b-b672-4df6-86f3-fe886c33710c",
      "signature": "94746124b618e7f4e67e92cc07ad9256258b1ac7022de7bb418f02f86da19798"
    }
```

Mercado Pago, en una:

```
[1] POST .../mercadopago/payments                          respondió 201

  Lo que el adaptador envió:
    {
      "transaction_amount": 150000,
      "description": "ORDER-DEMO-1790011947545",
      "external_reference": "ORDER-DEMO-1790011947545",
      "token": "tok_demo_no_real",
      "installments": 1,
      "payer": { "email": "jaime.pavlich@example.com" }
    }
```

`amount_in_cents: 15000000` contra `transaction_amount: 150000`, para el mismo
monto. Más la firma de integridad que Wompi exige y las otras tres no, y el token de
aceptación que obliga a una llamada extra.

Nada de eso aparece en el código que escribe el comercio, y nada de eso está escrito
en el ejemplo: sale del espía. Es la diferencia de escala del punto 42 del
`architecture-log.md`, que hasta ahora estaba *tolerada* en una comparación y ahora
está *explicada* en pantalla.

### Seis vocabularios nativos, un estado normalizado

Corriendo los ocho caminos —cuatro pasarelas por dos métodos— esto es lo que
devuelve cada una:

| Pasarela | Método | Estado normalizado | Estado nativo | Llamadas al crear |
|---|---|---|---|---|
| Wompi | tarjeta | `APPROVED` | `APPROVED` | 2 |
| Wompi | PSE | `APPROVED` | `APPROVED` | 3 |
| Mercado Pago | tarjeta | `APPROVED` | `approved` | 1 |
| Mercado Pago | PSE | `APPROVED` | `processed` | 1 |
| Kushki | tarjeta | `APPROVED` | `APPROVAL` | 1 |
| Kushki | PSE | `APPROVED` | `approvedTransaction` | 2 |
| Rapyd | tarjeta | `APPROVED` | `CLO` | 1 |
| Rapyd | PSE | `APPROVED` | `CLO` | 2 |

Seis formas distintas de decir "aprobado" —`APPROVED`, `approved`, `processed`,
`APPROVAL`, `approvedTransaction`, `CLO`— contra una sola que el comercio programa.
Y entre una y tres llamadas HTTP según la pasarela y el método, con el comercio
escribiendo siempre la misma línea.

La tabla del ejemplo de [intercambiabilidad](./intercambiabilidad.md) muestra cuatro
vocabularios porque solo recorre tarjeta. Al incluir PSE aparecen dos más.

### Que el SDK valida antes de gastar red

Elegir PSE en Mercado Pago muestra algo que ningún otro ejemplo deja ver, porque los
otros ya traen todos los datos puestos:

```
MERCADOPAGO exige datos que todavía no diste, y el SDK lo detectó sin gastar una llamada de red:
  PSE en Mercado Pago requiere estos datos y no llegaron: payer.firstName,
  payer.lastName, payer.phone y payer.phoneAreaCode, payer.address, ipAddress,
  returnUrlConfig con una URL aplicable a PENDING.

  Nombre del pagador [Jaime]:
  Apellidos del pagador [Pavlich Mariscal]:
  ...
```

Dos cosas pasan ahí. La primera es que el error nombra **todos** los faltantes de
una vez, en lugar de revelarlos de a uno a punta de HTTP 400. La segunda es que el
bloque de llamadas HTTP que se imprime después de completar los datos dice **una**
llamada: los rechazos anteriores no tocaron la red.

Y acá está la parte de diseño que importa. La demo pregunta esos datos **sin saber
que Mercado Pago los exige**: lee los nombres de campo del mensaje del SDK y los
busca en un catálogo indexado por campo del dominio.

```typescript
const EXTRA_FIELD_PROMPTS: Record<string, (draft: PaymentDraft) => Promise<void>> = {
  "payer.firstName": async (draft) => { /* ... */ },
  "payer.address":   async (draft) => { /* ... */ },
  ipAddress:         async (draft) => { /* ... */ },
  // ...
};
```

Indexado por campo y no por pasarela: una quinta pasarela que exija los mismos datos
no agrega ninguna entrada. Por eso la demo pregunta solo lo que la pasarela elegida
necesita, sin contener la lista de lo que cada una necesita.

Es la asimetría que el recorrido de [Mercado Pago con PSE](../03-sdk/4-guia-de-implementacion.md)
documenta —seis datos más que Wompi para el mismo método— convertida en algo que se
ve al correrlo.

### La ramificación obligatoria de `PaymentResult`

Con PSE, y con tarjeta en Rapyd, el resultado no es una transacción sino una
redirección pendiente. El compilador no deja leer `result.transaction` sin haber
descartado esa rama antes, y la demo lo dice en pantalla cuando ocurre.

Es el mejor lugar del repositorio para mostrar por qué existe la unión discriminada
del issue #64: acá la obligación no se explica, se ve.

## Lo que la demo no puede mostrar

**Los caminos de falla.** Rechazo, timeout, error de red y expiración no están en la
API de Simulación todavía: es el [issue #65](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/65).
Cuando esté cerrado, la demo puede recorrerlos y mostrar cómo el `ErrorHandler`
traduce cada error nativo a la jerarquía `KitPagosError`, que es la otra mitad de lo
que el SDK unifica. Hoy solo se ve la mitad feliz.

**Las URL de redirección que salen del simulador.** La demo visita la URL para hacer
de pagador, pero Kushki devuelve una de `sandbox-pse.kushkipagos.com`, que es lo que
devuelve de verdad. En ese caso la visita falla y la demo lo explica en vez de
caerse: en un pago real esa página la abre una persona en su navegador.

**La tokenización.** El token de tarjeta es de mentira y la demo no lo pregunta. En
producción lo emite el frontend contra la pasarela, que es el único lugar donde se
puede tocar la tarjeta sin meter al servidor del comercio dentro del alcance de PCI
DSS. Pedirle al usuario que invente un token no enseñaría nada, y pedir el número de
tarjeta enseñaría lo contrario de lo correcto.

## Un detalle de implementación que costó

`rl.question()` de `readline/promises` **nunca resuelve** si la entrada se cierra
—Ctrl+D, o una tubería que se agota. La promesa queda colgada, el bucle de eventos
se queda sin trabajo y Node termina con código 0 sin haber hecho nada.

La primera versión de la demo moría así: en silencio, con código de salida 0, y
parecía haber funcionado. Es la peor forma de fallar de un artefacto de
demostración, porque un artefacto que falla en verde no avisa que se rompió. Ahora
cada pregunta vigila el cierre de la entrada y aborta con un mensaje.
