# Guía de prueba: el cliente C contra el simulador y contra los sandboxes reales

Para quien revisa el issue #109 o quiere ver el prototipo C funcionando. Dice cómo correrlo en cada modo y qué tiene que salir en cada pasarela, con lo que se midió entre el 15 y el 17 de octubre de 2026. Lo que no sale igual no es necesariamente un defecto: la última sección separa lo que depende de cada sandbox.

El recorrido completo del cliente está en [checkout-frontend-rest.md](checkout-frontend-rest.md), y las decisiones en los puntos 91 a 106 del [architecture-log](../architecture/architecture-log.md).

## 1. Antes de empezar

1. Node 20 o más reciente.
2. El `.env` de la raíz del repositorio con las credenciales de sandbox de las cuatro pasarelas. De ahí el cliente toma solo las llaves públicas (`WOMPI_PUBLIC_KEY`, `MERCADOPAGO_PUBLIC_KEY` y `KUSHKI_PUBLIC_KEY`, una línea con el mismo valor de `KUSHKI_PUBLIC_MERCHANT_ID`), y solo las usa la tarjeta de las pasarelas que tokenizan en el navegador: el navegador crea el token con la llave de este archivo y la API lo cobra con sus credenciales, así que tienen que ser del mismo par que tiene la API (con `npm start`, el de Render). El PSE no usa nada de este archivo con `npm start`. Si el servidor no lo encuentra —en un worktree sin `.env`, por ejemplo—, arranca igual, dice «Llaves públicas para tarjeta: ninguna; la tarjeta queda deshabilitada», la consola lo repite y la tarjeta sale deshabilitada con las pasarelas que tokenizan en el navegador (con Rapyd sigue disponible, porque se escribe en su página): se le pasa con `--dotenv=<ruta>`.
3. **Para Mercado Pago, el par de prueba correcto.** Tiene que ser el de «Pruebas > Credenciales de prueba» de una aplicación de Checkout API vía Orders, cuya cuenta es un vendedor de prueba; los dos valores empiezan por `APP_USR-`. Un par `TEST-` cobra tarjeta por la Payments API, pero la Orders API, que es la del PSE, le responde `401`. Un par `APP_USR-` de la aplicación de producción cobra de verdad (punto 95). El del proyecto es el de su tercera aplicación de Orders, el mismo en el `.env` y en Render. Con él se cobraron tarjetas el 17 de octubre y el PSE siguió funcionando (sección 5).
4. El build del cliente:
   ```bash
   cd prototypes/checkout-frontend-rest
   npm ci
   npm run build
   ```
5. Para el PSE de Mercado Pago no hace falta nada más. Mercado Pago no acepta volver a `localhost`, y por eso la tienda se abre en `localtest.me` (sección 3).

## 2. Los modos

| Comando | API | Ambiente | Qué se prueba |
|---|---|---|---|
| `npm start` | La de Render | `sandbox` | Los sandboxes oficiales, con las credenciales del servidor de Render. Es el modo por omisión |
| `npm run start:local` | `localhost:3000` | `simulator` | Todo contra un simulador encendido en la máquina, tarjeta incluida |

El simulador de Render queda como opción: `npm start -- --environment=simulator` prueba el PSE de las cuatro pasarelas con las páginas de banco del simulador, con la tarjeta deshabilitada, porque en `simulator` el SDK solo tokeniza contra `localhost:3000`.

Se abre `http://localtest.me:4100` (sección 3): la tienda «Tostadero Ceiba». La franja de arriba dice si los pagos son simulados o del sandbox. La API, el ambiente y, en `sandbox`, el aviso de que la API usa sus propias credenciales van a la consola del navegador (F12), con el prefijo `[tienda C]`. Las opciones (`--api-url`, `--environment`, `--dotenv`, `--public-key`, `--port`) se pasan después de `--`, y funcionan igual en bash, PowerShell y cmd. En PowerShell, `set VARIABLE=valor` no define una variable de entorno: use los argumentos.

**Si la API es la de Render**, tiene que correr el código del #109. Mientras el PR no esté integrado, el cuerpo del PR dice cómo desplegar temporalmente su commit en Render y cómo volver a `devops`.

## 3. En `localtest.me`, sin túnel, para el PSE de Mercado Pago

Mercado Pago rechaza una `callback_url` que apunta a `localhost`, y el cliente manda su propio origen. Por eso la tienda se abre en `http://localtest.me:4100`, no en `localhost:4100`. `localtest.me` es un dominio público que resuelve a `127.0.0.1`: Mercado Pago lo acepta, y el banco devuelve al comprador a la máquina.

- **El carrito se guarda por origen**, así que la tienda se usa entera en `localtest.me`.
- **Si una red no lo resuelve**, basta una línea en `/etc/hosts`: `127.0.0.1 localtest.me`.
- **Con la API en la máquina** (`--api-url=http://localhost:3100/v1/api`) tampoco hace falta túnel. La página en `localtest.me` llama a la API en `localhost` sin problema, porque las dos están en la máquina, y la API toma la IP del pagador de la conexión.

Medido el 22 de octubre de 2026 (punto 120):

- **Con `npm start`**, que usa la API de Render: la tarjeta y el PSE de las cuatro pasarelas.
- **Con la API en la máquina:** el PSE de Mercado Pago.

Los resultados están en la sección 4.

Hasta ese día esto se hacía con un túnel de `cloudflared` para la página y otro para la API, que tenía que arrancar con `SIMULATOR_TRUST_FORWARDED_FOR=true`. Si se sigue usando un túnel, hay que tener en cuenta que un `502` de la API detrás de él llega como `API_UNREACHABLE`. Cloudflare cambia el `502` por su propia página, sin CORS, y el navegador no la deja leer. El mensaje lo dice, y el registro de la API muestra si la petición llegó.

## 4. Qué tiene que salir contra los sandboxes reales

Medido el 15 de octubre de 2026 entre las 21:47 y las 22:12 (UTC−5) con la API de la rama detrás de un túnel, el 16 de octubre a las 09:07 para el PSE de Mercado Pago, y el 17 de octubre entre las 20:23 y las 20:27 para la tarjeta de las cuatro, desde la tienda (punto 106). Los formularios traen datos de prueba válidos: monto 50 000 COP, pagador con documento, teléfono y dirección, y titular `APRO Ruiz`.

| Pasarela | Qué hacer | Qué tiene que salir |
|---|---|---|
| Wompi | PSE con «Banco que aprueba (1)» | `APPROVED` en la primera respuesta, sin página de banco: el sandbox de Wompi no la tiene |
| Wompi | PSE con el banco `2` | `DECLINED`, sin motivo (Wompi no da código de rechazo) |
| Wompi | PSE con el banco `3` | `ERROR` |
| Wompi | Tarjeta `4242 4242 4242 4242` | `APPROVED` |
| Wompi | Tarjeta `4111 1111 1111 1111` | `DECLINED` |
| Rapyd | PSE con cualquier banco de la lista; la tienda lleva a la página del banco. «Success» y «Pay» | La lista trae 9 bancos, los que el sandbox cobra. La página real «Rapyd Bank Payment Simulation», la vuelta al cliente y `APPROVED` (`CLO`) |
| Rapyd | PSE; en la página del banco, «Error» y «Pay» | La misma página, la vuelta y `ERROR` (`ERR`) |
| Rapyd | Tarjeta; en `sandboxcheckout.rapyd.net`, `4111 1111 1111 1111`, una fecha futura, CVV `123` y un nombre, «Place Your Order»; en el «Rapyd 3DS Simulator», el código `123456` y «Continue» | La tienda no pide la tarjeta: dice «Escribirás los datos de la tarjeta en la página segura de la pasarela» y lleva a la página de Rapyd. Después del simulador de 3DS, Rapyd vuelve solo a la tienda, también a `localhost` (sin túnel), y sale «¡Gracias! Tu pago fue aprobado» |
| Kushki | PSE; en la página del banco, «Volver al comercio» | La página real «Kushki Bank» con «Transacción pendiente», la vuelta con `token=` en la URL, «Confirmando tu pago…» con el avance de las diez consultas, unos 15 s, y «Tu pago está en proceso» (`PENDING`, `initializedTransaction` en la consola), con «Consultar de nuevo». **El estado no cambia**, ni con los documentos de prueba (ver la sección 5) |
| Kushki | Tarjeta `4242 4242 4242 4242`, la que trae el formulario | Se tokeniza en el navegador contra UAT y se cobra por el mismo monto: `APPROVED` (`APPROVAL`) en la primera respuesta. Necesita `KUSHKI_PUBLIC_KEY` en el `.env` |
| Mercado Pago | Tarjeta `4013 5406 8274 6260`, 11/2030, CVC 123, titular `APRO Ruiz` | `APPROVED` (`processed`), con un id `ORDTST…`. Medido con la tercera aplicación el 17 de octubre a las 20:27 |
| Mercado Pago | La misma tarjeta con el titular `OTHE Ruiz` | `DECLINED` con el motivo `rejected_by_issuer` |
| Mercado Pago | PSE, en `localtest.me` (sección 3) | El 22 de octubre, sin túnel, salió aprobado con `npm start` (pedido `CEIBA-1792700236128`) y con la API en la máquina (`CEIBA-1792700996066`) (punto 120). Hasta entonces se medía por un túnel. La tienda lleva directo a `www.mercadopago.com.co/sandbox/payments/<id>/bank_transfer`, que abre «Banco Prueba PSE». Ahí: usuario y contraseña cualesquiera, «APROBAR PAGO», «Enviar», «Estado de la Transacción: OK» y «Volver al comercio», que pasa por el comprobante de Mercado Pago y vuelve a la tienda con `payment_id=`: «¡Gracias! Tu pago fue aprobado» (`APPROVED`, `processed` en la consola). Medido por la tienda el 17 de octubre a las 15:23, a las 15:46 y a las 16:35 con la API local, y a las 16:55 con `npm start`, por Render, siempre con la tercera aplicación. Sin «Volver al comercio», la orden se quedó en `action_required` (sección 5). Si en vez del enlace sale un pago pendiente que termina `DECLINED` con `processing_error`, es el límite del sandbox de la sección 5: así salió por el cliente C a las 19:07, y con la tercera aplicación el 18 de octubre desde las 22:07 y el 19 entre las 14:09 y las 14:17. Pasados unos minutos vuelve a funcionar (punto 113) |

## 5. Lo que depende de cada sandbox, no de este código

- **Kushki no cierra el PSE en este comercio de UAT.** Cinco transferencias, una por cada documento de prueba, seguían `initializedTransaction` entre 11 y 35 horas después de creadas. La documentación de Kushki dice que la simulación de estados la activa Kushki para cada comercio: es una limitación de cómo Kushki configura su UAT, no de este código, y quien quiera ver el desenlace tiene que pedírsela a Kushki (`docs/testing-data/kushki.md`, 5.2.2). El simulador, en cambio, responde `approvedTransaction` en la primera consulta.
- **El PSE de Mercado Pago deja de entregar URL de banco.** La primera aplicación del proyecto la entregó el 15 de octubre a las 13:12 y dejó de hacerlo a las 21:33: la orden nacía `processing` y terminaba `processing_error`. Una segunda aplicación, con el mismo vendedor de prueba, la entregó dos veces el 16 de octubre a las 15:38 y a las 15:41, y a las 19:07 falló igual, también con el mismo cuerpo que había funcionado. Una tercera la entregó en sus ocho PSE del 17 de octubre, de las 12:41 a las 16:55, el último por Render, sin cobros con tarjeta en medio. La causa no se conoce y no es la petición (punto 100): falta saber si el corte depende del tiempo o de los cobros con tarjeta que hubo en las dos primeras. Con la tercera se cobraron tarjetas el 17 de octubre por la tarde, y el PSE de justo después funcionó; si se corta en las horas siguientes, la hipótesis de las tarjetas gana peso (punto 106). Si la página muestra un pago pendiente que termina `DECLINED` con `processing_error`, es esto, y el cliente se comporta como debe. **El 18 de octubre la tercera aplicación también se cortó** (punto 108). Entre las 22:07 y las 22:10, tres PSE por la tienda, con la API de la rama detrás de un túnel, nacieron `processing` sin URL de banco y terminaron `failed` / `processing_error`. Uno más, mandado directo a la API de Render, terminó igual, así que no fue el túnel ni el código. Ese día hubo cobros con tarjeta a las 19:03 y a las 22:07; no se sabe desde cuándo dejó de entregarla. En el simulador, el mismo PSE va a la página de banco y vuelve aprobado. **El 19 de octubre la misma aplicación volvió a entregar la URL sola** (punto 113). Siete PSE fallaron entre las 14:09 y las 14:17, y desde las 14:25 la misma petición, con el mismo pagador y por Render, llegó al banco. El corte es por ventanas, no definitivo, y no lo provoca una tarjeta aprobada. **Si falla, espere entre 10 y 15 minutos y reintente**, sin crear otra aplicación. La consola del navegador (`[tienda C]`) muestra si el pago llegó a la API y qué respondió Mercado Pago. **Termine cada PSE en «Banco Prueba PSE»**, aprobándolo o eligiendo «USUARIO ABANDONÓ TRANSACCION EN BANCO»; no lo deje abierto.
- **El sandbox de Rapyd solo cobra 9 de sus 50 bancos.** Con los otros 41 el pago responde `400 ERROR_GET_GATEWAY`: la cuenta no tiene procesador para ellos. Desde la 0.6.0-rc.3, el SDK los quita de la lista cuando habla con el sandbox, así que el cliente muestra solo Davivienda, Bancolombia, Caja Social, AV Villas, Unión, Contactar, Acción Fiduciaria, Ding y PayCash (`docs/testing-data/rapyd.md`, 5.8; punto 102). Si aparece otro banco de Rapyd en `sandbox`, la API no está corriendo la rc.3.
- **Mercado Pago no rechaza un cobro duplicado.** Dos cobros con la misma referencia crean dos órdenes; la única protección es la llave de idempotencia, que el SDK genera aleatoria en cada cobro. El comercio tiene que consultar antes de reintentar (punto 100).

## 6. Qué tiene que salir contra el simulador

Con `npm run start:local` o con el simulador de Render (`npm start -- --environment=simulator`, con el código del #109):

- **El PSE de las cuatro pasarelas** lleva a la página de banco del simulador, que dice que es del simulador. «Volver al comercio» devuelve al cliente, con `payment_id=` en Mercado Pago y `token=` en Kushki, y la consulta da `APPROVED`.
- **Wompi con el banco `2`** da `DECLINED` sin redirección.
- **Kushki con el documento `999999990`** queda pendiente después de volver, y la confirmación ofrece «Consultar de nuevo».
- **La tarjeta**, solo con `start:local`: Wompi, Mercado Pago y Kushki `APPROVED` (Kushki tokeniza contra `localhost:3000/v1/sim/kushki/card/v1/tokens`); Mercado Pago con `OTHE Ruiz`, `DECLINED` con su motivo; Rapyd lleva a la página de pago simulada, que ofrece «Volver al comercio», y sale `APPROVED`.

## 7. Cómo reportar

Una captura por cada paso del pagador, incluida cada página a la que lleva la tienda aunque sea de un dominio externo, con la hora y el modo (`npm start`, `start:local` o `npm start -- --environment=simulator`). La tienda no muestra datos técnicos: la API, el ambiente, cada llamada a `/v1/api` con su código, el estado nativo de cada pago y la URL a la que redirige van a la consola del navegador (F12, con el prefijo `[tienda C]`). Si algo no coincide con estas tablas, adjunte esa consola.
