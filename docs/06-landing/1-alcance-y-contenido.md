# La página de presentación: alcance y contenido

Uno de los cuatro entregables de la Iteración 3. Este documento define qué es, qué no es, qué tiene que decir y cómo se evita que se desactualice.

> **Estado: propuesto, no construido.** Lo que sigue es la especificación acordada antes de escribir código. Cuando la página exista, este documento pasa a describirla en presente.

---

## 1. Por qué hace falta

Los tres componentes del Kit Pagos existen y funcionan, pero para verlos hay que clonar el repositorio, instalar tres paquetes de Node, compilar el SDK y levantar la API de Simulación en una terminal aparte. Eso está bien documentado en [00-entorno-de-desarrollo.md](../00-entorno-de-desarrollo.md), y toma unos minutos.

El problema es quién tiene que hacerlo. Hay tres audiencias que **no van a clonar nada**:

1. **El jurado de la tesis**, que necesita entender el artefacto y evaluar si resuelve el problema planteado, no depurar una instalación de Node.
2. **Un desarrollador colombiano** que llegó buscando cómo integrar PSE y quiere saber en treinta segundos si esto le sirve. Si la primera pantalla es un `git clone`, se va.
3. **Cualquiera que evalúe el proyecto después**: un profesor, un empleador, otro tesista.

Para las tres, el repositorio es la evidencia y no la presentación. La página es lo que convierte tres meses de trabajo medido en algo que se entiende sin instalar nada.

---

## 2. El mensaje, en una frase

Toda la página existe para sostener esta afirmación:

> **Integrás una vez. Cambiás de pasarela cambiando un valor.**

Y debajo, la aclaración honesta que la hace creíble en lugar de sonar a folleto:

> Cuatro pasarelas colombianas, tarjeta y PSE, con los datos de prueba documentados para que puedas verificarlo vos.

Si una sección de la página no contribuye a sostener o a acotar esa frase, no va en la página.

---

## 3. Lo que tiene que mostrar, en orden

### 3.1 El problema, en la primera pantalla

Antes de decir qué hace el Kit Pagos, la página muestra **por qué existe**. La forma más eficiente es poner el mismo cobro escrito para dos pasarelas distintas, lado a lado, sin abstracción de por medio: un lado en centavos con firma de integridad SHA-256, el otro en pesos con clave de idempotencia obligatoria y desglose de IVA. El material está en [01-producto/3-las-cuatro-pasarelas.md](../01-producto/3-las-cuatro-pasarelas.md).

Nadie tiene que leer ese código. Tiene que **verse** que no se parecen.

### 3.2 La demostración

El bloque central: el mismo pago, cobrado por las cuatro, con una sola línea distinta resaltada.

```ts
const kitPagos = new KitPagos({
  gateway: Gateway.WOMPI,       // <- lo único que cambia
  credentials,
});

const resultado = await kitPagos.createPayment({
  amount: new Amount("150000.00"),
  currency: new Currency("COP"),
  orderReference: new OrderReference("ORDER-1"),
  payer: new Payer({ email: "cliente@example.com", fullName: "Jaime Pavlich" }),
  paymentMethod: PaymentMethod.card(token),
});
```

Al lado, la tabla de estados nativos que ya imprime el ejemplo 10, porque es la evidencia de que la unificación hace algo:

| Pasarela | Estado nativo | Estado normalizado |
|---|---|---|
| Wompi | `APPROVED` | `APPROVED` |
| Rapyd | `CLO` | `APPROVED` |
| Mercado Pago | `approved` | `APPROVED` |
| Kushki | `APPROVAL` | `APPROVED` |

Cuatro vocabularios, y uno —`CLO`— que no significa "pagado" sino "cerrado".

### 3.3 Los tres componentes

Que el Kit Pagos son tres cosas y no una es la idea que más se pierde cuando alguien mira solo el SDK. La página la deja explícita:

| Componente | Qué es | Para qué sirve |
|---|---|---|
| **SDK** | El paquete npm con la arquitectura hexagonal | Integrar una vez y cambiar de pasarela por configuración |
| **API de Simulación** | Cuatro mocks locales con 23 rutas | Probar flujos que los sandboxes reales no permiten probar |
| **Documentación de datos** | Las tarjetas, bancos y credenciales de prueba | Reproducir cualquiera de los flujos sin adivinar |

El tercero es el que más se subestima y el que más tiempo ahorra: es el que responde "¿qué número de tarjeta pongo para que me rechace el pago en Kushki?".

### 3.4 Lo que el proyecto no hace

Una sección explícita de límites, redactada a partir de [01-producto/4-por-que-kit-pagos.md](../01-producto/4-por-que-kit-pagos.md) §4. Como mínimo:

- Los **códigos de banco de PSE no son portables** entre pasarelas. El Kit Pagos unifica la forma de pedirlos, no los códigos.
- El **token de tarjeta tampoco** es portable: lo emite el frontend de cada pasarela.
- **Solo tarjeta y PSE.** No hay efectivo, ni Nequi, ni suscripciones, ni reembolsos.
- **La redirección no desaparece.** PSE redirige al portal del banco en las cuatro; el SDK unifica cómo se pide, no elimina el paso.
- Las **cifras comparativas todavía no existen**: las produce el experimento de la Fase 5.

Esta sección no es humildad decorativa. Es lo que separa un trabajo de grado de un anuncio, y es lo primero que un jurado va a buscar.

### 3.5 Cómo empezar

Tres comandos, y el enlace a [03-sdk/4-guia-de-implementacion.md](../03-sdk/4-guia-de-implementacion.md) para todo lo demás. La página no duplica la guía de implementación: la anuncia.

### 3.6 El contexto académico

Que es un trabajo de grado, con enlace a la documentación de la [metodología](../project-management/methodology.md) y al [`architecture-log.md`](../architecture/architecture-log.md). Va al final: importa para el jurado y para quien quiera auditar las decisiones, no para el desarrollador que llegó buscando integrar PSE.

---

## 4. Lo que la página **no** es

Marcar esto por adelantado evita que crezca sin control:

- **No es la documentación.** La documentación es este directorio `docs/`, y la de integración es el README del SDK, mantenido con `npm run check:readme`. La página enlaza, no reescribe.
- **No es un demo interactivo con backend.** Un formulario que cobre de verdad requiere credenciales, un servidor desplegado y manejo de secretos: tres problemas nuevos para una ganancia que el bloque de código ya consigue.
- **No es un blog** ni tiene sección de novedades.
- **No lleva analítica ni rastreo.** No hay nada que medir que justifique el costo de privacidad.

---

## 5. Dónde vive

Una decisión pendiente, con dos opciones y una recomendación.

**GitHub Pages desde `docs/landing/` o desde una rama `gh-pages`.** Es gratis, no agrega infraestructura, se despliega con la misma acción de GitHub que ya corre las pruebas, y la URL vive junto al repositorio que es la evidencia.

La alternativa sería un servicio de hosting estático como Vercel o Netlify. Da mejores dominios y despliegues por rama, pero introduce una cuenta y un panel más que mantener para una página estática que no lo necesita.

**La recomendación es GitHub Pages**, por una razón que no es técnica: es un trabajo de grado, y que la página y el código estén en el mismo lugar hace la auditoría más simple.

---

## 6. La guarda: por qué los fragmentos de código no se pueden escribir a mano

Este es el punto más importante del documento, y sale de algo que ya pasó en este repositorio.

El README del SDK tuvo **diez fragmentos de código roto publicados a la vez**: llamadas a métodos que se habían renombrado, tipos que ya no se exportaban, firmas con parámetros que habían cambiado de orden. Todos compilaban cuando se escribieron y ninguno después. Nadie se dio cuenta hasta que alguien intentó seguir el README.

De ahí salió `npm run check:readme`, que extrae los bloques de TypeScript del README y los compila contra el SDK construido. Está documentado en [04-metricas-y-pruebas/2-pruebas-del-sdk.md](../04-metricas-y-pruebas/2-pruebas-del-sdk.md) §5.

**La landing tiene exactamente el mismo problema, y peor:** es la primera cosa que alguien va a leer, y a diferencia del README, nadie la mira al cambiar el SDK.

Así que la regla es que **los fragmentos de código de la página tienen que estar sujetos a la misma guarda**, con dos caminos posibles:

1. **Extenderla.** Que `check:readme` también procese los archivos de la landing. Es lo más simple si los fragmentos viven en Markdown o en un archivo `.ts` aparte.
2. **Derivarlos.** Que la página tome sus fragmentos de los archivos de `examples/`, que ya pasan por `npm run typecheck` en el paquete de ejemplos. Es más robusto —el código mostrado es literalmente código que corre— pero requiere un paso de construcción que recorte las partes relevantes.

**Lo que no es aceptable es la tercera opción**, que es copiar y pegar y confiar. Ya sabemos cómo termina eso, y en la landing el costo es más alto porque es la primera impresión del proyecto.

---

## 7. Qué falta decidir

| Decisión | Estado |
|---|---|
| Hosting (Pages vs. Vercel/Netlify) | Recomendado Pages, sin cerrar |
| Cómo se guarda el código mostrado (extender `check:readme` vs. derivar de `examples/`) | Abierta |
| Si la página es una sola HTML o usa un generador estático | Abierta |
| Idioma: español solo, o español e inglés | Abierta; el repositorio es en español por convención |

---

## 8. Qué sigue

- **[05-ejemplos/README.md](../05-ejemplos/README.md)** — La salida real que la página va a mostrar.
- **[testing-data/README.md](../testing-data/README.md)** — El tercer componente, el que la página tiene que explicar porque es el menos obvio.
- **[project-management/methodology.md](../project-management/methodology.md)** — Dónde encaja este entregable en la Iteración 3.
