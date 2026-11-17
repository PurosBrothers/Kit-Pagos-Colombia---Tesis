# Los datos de prueba

Qué tarjeta, qué banco y qué documento usar para que cada pasarela haga lo que usted quiere que haga. Es el tercer componente del producto: sin estos datos, el SDK y el simulador no se pueden ejercitar contra nada.

Cada dato de esta página tiene un **nivel de evidencia**, y conviene saber cuál es antes de construir sobre él:

| Nivel | Qué significa |
|---|---|
| **1 — Medido** | Hay una petición HTTP real y su respuesta, con fecha |
| **2 — Medido a medias** | El flujo está comprobado hasta la redirección; de ahí en adelante no, porque hace falta una persona autorizando en el banco |
| **3 — Documentación oficial** | Está en la documentación del proveedor y **nadie lo ejecutó** |

**La regla de lectura:** si una afirmación no tiene fecha, asuma nivel 3. Y si va a construir sobre ella, mídala primero.

---

## 1. Wompi

### Tarjetas

| Estado | Número | Expiración | CVC |
|---|---|---|---|
| Aprobada (`APPROVED`) | `4242 4242 4242 4242` | Cualquier fecha futura | Cualquiera de 3 dígitos |
| Declinada (`DECLINED`) | `4111 1111 1111 1111` | Cualquier fecha futura | Cualquiera de 3 dígitos |

Cualquier otro número termina en `ERROR` según la documentación de Wompi —**nivel 3, sin medir**—, y el simulador, en cambio, lo aprueba.

> El cobro **nace `PENDING`, no `APPROVED`**: `POST /transactions` responde `201` con `finalized_at: null`, y la transacción se resuelve sola poco después. Medido el 19 de septiembre de 2026.

### Bancos PSE

En sandbox, la lista que devuelve `GET /pse/financial_institutions` **no son bancos**: son tres entidades cuyo código fuerza el desenlace.

| Código | Nombre literal de la API |
|---|---|
| `"1"` | Banco que aprueba |
| `"2"` | Banco que declina |
| `"3"` | Banco que simula un error |

Los nombres no son un chiste: quien ve «Banco que declina» en su selector sabe al instante contra qué entorno está apuntando. El desenlace del código `3` se midió el 5 de octubre de 2026 y termina en `ERROR`.

---

## 2. Mercado Pago

### Tarjetas

| Tipo | Marca | Número | CVV | Caducidad |
|---|---|---|---|---|
| Crédito | Mastercard | `5254 1336 7440 3564` | `123` | `11/30` |
| Crédito | Visa | `4013 5406 8274 6260` | `123` | `11/30` |
| Débito | Visa | `4915 1120 5524 6507` | `123` | `11/30` |

La tarjeta de débito medida dio `422 unprocessable_content` al cobrar (15 de octubre de 2026). La que lista hoy la documentación oficial de la Orders API es `4912 6840 6309 1904`, y no se midió.

### El desenlace lo decide el nombre del titular

Se escribe en el campo de nombre del titular, **por prefijo** y **distinguiendo mayúsculas**: `APRO Ruiz` cuenta como `APRO`.

| Resultado | Titular | Documento |
|---|---|---|
| Aprobado | `APRO` | `123456789` |
| Rechazado por error general | `OTHE` | `123456789` |
| Pendiente | `CONT` | — |
| Rechazado, requiere autorizar | `CALL` | — |
| Rechazado por fondos insuficientes | `FUND` | — |
| Rechazado por código de seguridad | `SECU` | — |
| Rechazado por fecha de vencimiento | `EXPI` | — |
| Rechazado por error de formulario | `FORM` | — |

La documentación de Mercado Pago lista otros trece (`CARD`, `INST`, `DUPL`, `LOCK`, `CTNA`, `ATTE`, `BLAC`, `UNSU`, `TEST`…). Están en [`testing-data/mercado-pago.md`](../../testing-data/mercado-pago.md).

> **Un titular fuera de la tabla no rechaza en el simulador.** La API real rechazó `Felipe Ruiz` con `rejected_by_issuer` (medido el 15 de octubre de 2026), pero imitarlo dejaría a cualquier titular real sin poder probar nada.

### PSE

Mercado Pago cobra PSE por la Orders API, que es **distinta de la API de pagos** con la que cobra la tarjeta. Exige nombre y apellido separados, teléfono con indicativo, dirección completa e **IP del pagador**.

---

## 3. Kushki

### Tarjetas

| Escenario | Número | Respuesta |
|---|---|---|
| Aprobada | `5451 9515 7492 5480` | `(000) Transacción aprobada` |
| Declinada al tokenizar | `4574 4412 1519 0335` | `(017) Tarjeta no válida` |
| Rechazada al cobrar | `4349 0030 0004 7015` | `(017) Tarjeta no válida` |
| No compatible | `4349 0085 1665 6431` | `(019) Tarjeta no compatible` |
| Sin fondos | `4349 0012 1084 6432` | `(021) Tarjeta sin fondos` |
| CVV inválido | `4349 0032 4337 1321` | `(022) Imposible verificar CVV` |
| Bloqueada | `4349 0013 8678 1322` | `(023) Tarjeta bloqueada` |

CVV, código postal y fecha de vencimiento son libres. El código del banco llega en `details` del `400`, y el SDK lo entrega como una transacción `DECLINED` con ese código.

### Transferencias (así llama Kushki a PSE)

El desenlace lo determina el **número de documento** del pagador, al pedir el token de la transferencia.

| Escenario | Documento |
|---|---|
| Exitosa | `123456789` |
| Pendiente | `999999990` |
| Declinada | `100000002` |
| Fallida | Cualquier otro |

**El documento predetermina el desenlace pero no lo dispara**: medido el 18 de septiembre de 2026, las cuatro quedaron en `requestedToken` y pasaron a `initializedTransaction` al iniciar, y el estado final llega cuando el flujo del banco se completa.

Tipos de documento válidos en Colombia: `CC`, `NIT`, `CE`, `TI`, `PP`. La API acepta además `RUC`, `CURP`, `RFC`, `RUT`, `DNI`, `PAS`, `CI` y `DE`, que no aplican acá.

---

## 4. Rapyd

### Tarjetas

| Estado | Número |
|---|---|
| Aprobada (`SUCCESS` / `CLO`) | `4111 1111 1111 1111` |
| Aprobada (`SUCCESS` / `CLO`) | `4462 0300 0000 0000` |

Cualquier fecha futura y cualquier CVC de tres dígitos. La tarjeta va por **checkout alojado**: el pagador la escribe en la página de Rapyd, no en la suya, y el código de 3DS es `123456`.

### PSE

**Rapyd no tiene un método de pago PSE: tiene uno por banco.** El catálogo trae hoy 50 métodos `co_pse_*`, y el sandbox de la organización de prueba **solo procesa 9** (medido el 17 de octubre de 2026 entre las 10:52 y las 11:00):

| Resultado | Bancos |
|---|---|
| Redirige y queda `ACT` | `co_pse_banco_davivienda_bank`, `co_pse_bancolombia_bank`, `co_pse_banco_caja_social_bank`, `co_pse_banco_av_villas_bank`, `co_pse_banco_union_bank`, `co_pse_banco_contactar_bank`, `co_pse_accion_fiduciaria_bank`, `co_pse_ding_bank`, `co_pse_paycash_bank` |
| `400 ERROR_GET_GATEWAY` | Los otros 41, entre ellos `co_pse_nequi_bank`, `co_pse_daviplata_bank` y `co_pse_banco_de_bogota_bank` |

Ese `400` significa que la cuenta no tiene procesador para ese método: el método existe en el catálogo, pero esa organización de sandbox no lo puede cobrar. En producción, donde solo se listan los habilitados, no pasa.

---

## 5. Los huecos conocidos

Estos son los límites reales de lo que el proyecto puede afirmar hoy:

| Pasarela | Hueco | Por qué |
|---|---|---|
| **Wompi** | El desenlace del PSE no se puede observar | El sandbox publica la URL de redirección en el mismo instante en que resuelve el pago: cuando la URL existe, ya no sirve |
| **Mercado Pago** | La Orders API de PSE | Con el token `TEST-` responde `401`; exige el token `APP_USR-` |
| **Kushki** | El desenlace de la transferencia | Exige que una persona autorice en el portal del banco |
| **Rapyd** | Los estados finales de PSE | No se sabe si el sandbox permite forzarlos como sí hace con 3DS |
| **Rapyd** | Qué métodos PSE tiene activos una cuenta real | El sandbox devuelve el catálogo completo; producción, solo los habilitados |

Los tres primeros son la razón de que exista la API de Simulación: es el único lugar donde esos flujos se pueden ejercitar de punta a punta.

---

## 6. Cómo se mantiene esto vigente

Las afirmaciones de nivel 1 las sostienen **18 pruebas de contrato** que corren contra los sandboxes reales y fallan si una pasarela cambia lo que estos documentos dicen:

```bash
cd sdk && npm run test:sandbox
```

Si algo no funciona como dice acá, revise la fecha de la afirmación: los sandboxes cambian, y una medición de septiembre de 2026 puede no valer hoy.

El detalle completo de cada pasarela, con los payloads y la evidencia de cada dato, está en [`docs/testing-data/`](../../testing-data/).
