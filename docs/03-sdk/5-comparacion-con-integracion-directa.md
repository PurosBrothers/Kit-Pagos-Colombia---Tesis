# Comparación con integrar directamente

Este documento compara integrar con el SDK contra integrar a mano contra las APIs nativas. Y empieza con una advertencia sobre su propio alcance, porque importa más que cualquier tabla que venga después:

> **Las cifras formales todavía no existen.** Las produce el experimento de la Fase 5: dos prototipos funcionalmente idénticos, uno con SDK y otro con integración directa, medidos con seis variables contables por script. Su diseño está en [prototypes-evaluation-plan.md](../project-management/prototypes-evaluation-plan.md) y su construcción es un entregable de la Iteración 3.
>
> Lo que hay acá es la comparación **cualitativa y verificable**: qué escribe el comercio en cada caso, qué conceptos nativos queda obligado a aprender, cuántas llamadas HTTP se le esconden. Todo eso se puede comprobar leyendo código hoy. Lo que **no** se puede afirmar todavía es "el SDK reduce el código en un X %", y este documento no lo afirma.

---

## 1. Qué escribe el comercio para cobrar

### Con integración directa contra Wompi

```ts
// 1. Pedir el token de aceptación, que es de un solo uso.
const merchant = await fetch(`${WOMPI_URL}/merchants/${PUBLIC_KEY}`, {
  headers: { Authorization: `Bearer ${PUBLIC_KEY}` },
});
const { data } = await merchant.json();
const acceptanceToken = data.presigned_acceptance.acceptance_token;

// 2. Convertir el monto a centavos. Y acá hay una trampa de punto flotante:
//    monto * 100 puede dar 1998.9999999999998 para 19.99.
const amountInCents = Math.round(monto * 100);

// 3. Calcular la firma de integridad, sin la cual Wompi responde 422.
const signature = createHash("sha256")
  .update(`${referencia}${amountInCents}COP${INTEGRITY_SECRET}`)
  .digest("hex");

// 4. Cobrar.
const respuesta = await fetch(`${WOMPI_URL}/transactions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${PRIVATE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    amount_in_cents: amountInCents,
    currency: "COP",
    reference: referencia,
    customer_email: correo,
    acceptance_token: acceptanceToken,
    payment_method: { type: "CARD", token, installments: 1 },
    signature,
  }),
});

// 5. Traducir el estado nativo al vocabulario del comercio.
const cuerpo = await respuesta.json();
const estado = cuerpo.data.status === "APPROVED" ? "aprobado"
  : cuerpo.data.status === "DECLINED" ? "rechazado"
  : "pendiente";

// 6. Y falta: distinguir error transitorio de definitivo, manejar el caso en que
//    haga falta redirigir por 3DS, y sondear si quedó PENDING.
```

### Con el SDK

```ts
const resultado = await sdk.createPayment({
  amount: new Amount("75000"),
  currency: new Currency("COP"),
  orderReference: new OrderReference(referencia),
  payer: new Payer({ email: correo }),
  paymentMethod: PaymentMethod.card(token, { installments: 1 }),
});

if (resultado.outcome === "REDIRECT_REQUIRED") {
  return redirigirA(resultado.redirect.redirectUrl);
}

const estado = resultado.transaction.getStatus();
```

La diferencia de volumen es visible, pero **no es el punto principal**. El punto es qué desaparece de la cabeza del desarrollador.

---

## 2. Qué conceptos nativos deja de tener que aprender

Esto es la variable 4 del experimento de la Fase 5, y es contable: cuántos identificadores propios de una pasarela aparecen en el código del comercio.

| Concepto nativo | Con integración directa | Con el SDK |
|---|---|---|
| `amount_in_cents` y la conversión a centavos | Hay que conocerlo y hacerla | No aparece |
| La fórmula exacta de la firma de integridad | Hay que implementarla | No aparece |
| El token de aceptación y que es de un solo uso | Hay que pedirlo y no reutilizarlo | No aparece |
| `APPROVED`, `DECLINED`, `VOIDED`, `PENDING` de Wompi | Hay que traducirlos | No aparecen |
| `transaction_amount` y `X-Idempotency-Key` de Mercado Pago | Hay que conocerlos | No aparecen |
| Que el PSE de Mercado Pago está en otra API | Hay que descubrirlo | No aparece |
| El objeto de desglose de IVA de Kushki | Hay que armarlo | No aparece |
| Los dos vocabularios de estado de Kushki | Hay que manejar los dos | No aparecen |
| La firma HMAC por petición de Rapyd, con sus tres trampas | Hay que implementarla | No aparece |
| Que `CLO` de Rapyd no significa "pagado" | Hay que saberlo o se despacha sin cobrar | No aparece |

**En el prototipo con SDK ese conteo debería ser cero.** Y el plan de evaluación dice algo importante al respecto: si aparece un solo `amount_in_cents` en el código del comercio, **la abstracción tiene una fuga**, y eso es un hallazgo negativo que hay que reportar igual. La medición está diseñada para poder fallar.

---

## 3. Qué llamadas HTTP se esconden

| Operación | Integración directa | Con el SDK |
|---|---|---|
| Cobrar con tarjeta en Wompi | 2 peticiones | 1 llamada |
| Cobrar con PSE en Wompi | 1 petición más un bucle de sondeo | 1 llamada |
| Cobrar con PSE en Kushki | 2 peticiones, con headers de autenticación distintos entre sí | 1 llamada |
| Cobrar con PSE en Rapyd | 2 peticiones, las dos firmadas con HMAC | 1 llamada |
| Consultar estado en Mercado Pago | 1 petición, eligiendo entre dos rutas según el formato del id | 1 llamada |
| Consultar estado en Kushki | Hasta 3 peticiones en orden de tanteo | 1 llamada |

El caso de Kushki es el más elocuente. Un comercio que integre a mano tiene que descubrir por sí mismo que Kushki no publica un discriminador entre sus identificadores, que la ruta obvia responde `403` para todo, y que el orden de tanteos tiene que empezar por la de transferencia porque es la única que emite un "no existe" del que se puede encadenar. Eso costó dos rondas de medición contra la API real y una conclusión equivocada en el medio. Está en [3-las-pasarelas-por-dentro.md](3-las-pasarelas-por-dentro.md).

---

## 4. Lo que se unifica sin que el comercio lo pida

**Los estados.** Seis valores normalizados en lugar de cuatro vocabularios, con el estado nativo conservado para auditoría. Y con el caso de `CLO` resuelto correctamente: el SDK solo lo traduce a aprobado si además viene `paid: true`.

**Los errores.** Doce códigos en lugar de los formatos de error de cuatro proveedores, cada uno con su propio esquema de mensajes. Y con la distinción que más importa ya hecha: qué se reintenta y qué no.

**Las firmas de webhook.** Cuatro algoritmos distintos detrás de una sola llamada, con comparación en tiempo constante y ventana anti-replay incluidas. Esta es, probablemente, la parte donde el SDK evita más daño: una verificación de firma implementada con `===` o sin ventana anti-replay **no falla**. Acepta notificaciones falsas, y el comercio no se entera hasta que alguien lo explota.

**La redirección.** Un tipo de retorno que el compilador obliga a manejar, en lugar de un campo opcional que se puede ignorar sin que nada se queje.

---

## 5. El experimento que de verdad importa: migrar

El plan de evaluación identifica la medición más valiosa, y no es el conteo de líneas de la integración inicial: es **el costo de cambiar de pasarela**, porque ese es el problema de negocio que motiva la tesis.

El procedimiento: los dos prototipos se implementan con Wompi, se hace un commit que cierre ese estado, y después se les pide migrar a Mercado Pago. Se mide el diff con `git diff --stat`, así que cualquiera lo puede auditar.

**Wompi a Mercado Pago no es una pareja elegida al azar:** son las dos que más se diferencian en los tres ejes que importan. Wompi pide centavos enteros y Mercado Pago decimales; Wompi usa estados en mayúsculas y Mercado Pago en minúsculas; el webhook de Wompi trae el pago completo y el de Mercado Pago solo un identificador que obliga a una segunda petición. Migrar entre dos pasarelas parecidas subestimaría el costo real.

**La hipótesis, escrita antes de medir:** en el prototipo con SDK la migración es un cambio de configuración de una línea, sin tocar el modelo de datos; en el de integración directa obliga a reescribir el mapeo de monto, la traducción de estados, la verificación de firma y el flujo de consulta.

Y una regla del plan que conviene subrayar: **si el resultado contradice la hipótesis, eso también es un hallazgo válido y hay que reportarlo**, no ajustar el experimento hasta que salga el número esperado.

---

## 6. Lo que el SDK no mejora

Para que la comparación sea creíble, el otro lado de la balanza:

**Agrega una dependencia.** El comercio pasa a depender de un paquete que tiene que mantenerse al día con los cambios de cuatro proveedores. Si una pasarela cambia su API y el SDK no se actualiza, el comercio queda esperando. Una integración directa la puede arreglar el mismo día.

**Agrega una capa de indirección al depurar.** Cuando algo falla, hay que entender qué hizo el SDK antes de entender qué hizo la pasarela. El SDK mitiga esto conservando `rawStatus` y `originalPayload`, pero no lo elimina.

**No elimina las diferencias de flujo, las hace explícitas.** El comercio sigue teniendo que manejar que Rapyd devuelva una redirección con tarjeta. Lo que cambia es que ahora el compilador lo obliga en lugar de que lo descubra en producción.

**No hace portables los códigos de banco ni los tokens.** Cambiar de pasarela sigue exigiendo volver a pedir la lista de bancos y volver a tokenizar con la librería de la pasarela nueva.

**Y el SDK todavía no tiene versión 1.0.** Está en `0.1.0`, con alcance declarado de tarjeta y PSE en cuatro pasarelas. Un comercio que necesite Nequi o Daviplata hoy no lo puede usar.

---

## 7. Qué se puede afirmar hoy, y qué no

**Se puede afirmar**, porque se verifica leyendo código:

- Que cambiar de pasarela en el código del comercio es cambiar el valor de `gateway`. Hay un ejemplo ejecutable que cobra el mismo pago por las cuatro y verifica que los resultados coincidan.
- Que el comercio no escribe ninguna fórmula de firma ni ninguna conversión de monto.
- Que las cuatro verificaciones de webhook usan comparación en tiempo constante y ventana anti-replay.
- Que el tipo de retorno hace imposible ignorar una redirección.

**No se puede afirmar todavía:**

- Ningún porcentaje de reducción de código.
- Ninguna cifra de tiempo de desarrollo. El plan de evaluación explica por qué esa métrica queda fuera como evidencia principal: quien implementa el segundo prototipo ya aprendió el dominio en el primero, y ese efecto de orden no se puede eliminar con cuatro personas y dos prototipos.
- Ninguna comparación de mantenibilidad a largo plazo. Requeriría observar los dos prototipos durante meses.

Esa separación entre lo verificable y lo pendiente es deliberada. Un documento que afirmara cifras sin el experimento hecho sería justamente lo que la evaluación de la Fase 5 existe para evitar.

---

## Qué sigue

- El diseño completo del experimento: [prototypes-evaluation-plan.md](../project-management/prototypes-evaluation-plan.md).
- Cómo se van a medir los prototipos, y qué falta para poder hacerlo: [04-metricas-y-pruebas/4-medir-los-prototipos.md](../04-metricas-y-pruebas/4-medir-los-prototipos.md).
- El ejemplo que demuestra la intercambiabilidad hoy: [05-ejemplos/intercambiabilidad.md](../05-ejemplos/intercambiabilidad.md).
