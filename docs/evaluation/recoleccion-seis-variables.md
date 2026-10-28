# Recolección de las Seis Variables del Experimento (Prototipos B y D)

**Issue:** [#134](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/134)  
**Fecha de medición base:** 22 de octubre de 2026 (sandboxes punto 120), actualizada al 28 de octubre de 2026  
**Commit de devops medido:** `eabba18` (código fuente de los prototipos evaluado en la base de la rama)  
**Commit de instrumentos:** `47ddf56` (`feat(sdk): version measurement instruments and document file-level CK metrics (#134)`)  
**Commit de datos:** commit inmediato que versiona este informe y sus reportes JSON (`docs(evaluation): record measurement data of the six variables for prototypes B and D (#134)`)  
**Sujetos experimentales:**
- **Prototipo D (control):** `prototypes/checkout-sin-solucion/` (integración directa manual contra las 4 pasarelas).
- **Prototipo B (tratamiento):** `prototypes/checkout-con-sdk-front-back/` (integración con `kit-pagos-colombia` v0.7.0-rc.2 con tokenización en frontend).

---

## 1. Tabla Resumen de las Seis Variables

| # | Variable | Prototipo D (Control) | Prototipo B (Tratamiento) | Diferencia / Efecto | Comando de reproducción |
|---|---|---|---|---|---|
| **1** | **Líneas de código de integración (LOC)** | **1 308** LOC<br>(TS: 1 191, JS: 117)<br>(374 comentarios, 172 blancos) | **310** LOC<br>(TS: 298, JS: 12)<br>(91 comentarios, 30 blancos) | **-76.30%** (-998 LOC de integración) | `npx cloc@2.10.0 --by-file prototypes/<dir>/src/payments` |
| **2** | **Costo de agregar cada pasarela** | Ver desglose abajo («líneas agregadas» del diff)<br>MP (`f335296`): +385 / −2<br>Kushki (`ad917db`): +338 / −2<br>Rapyd (`ccd54dd`): +319 / −1<br>**Total 3 nuevas: +1 042 / −5 líneas agregadas** | Ver desglose abajo («líneas agregadas» del diff)<br>MP (`7b00381`): +18 / −1<br>Kushki (`2466495`): +20 / −5<br>Rapyd (`daad2aa`): +29 / −8<br>**Total 3 nuevas: +67 / −14 líneas agregadas** | **-93.57%** de líneas agregadas en `src/payments/` para sumar 3 pasarelas (+1 042 vs +67) | `git show --numstat --format= <commit> -- prototypes/<carpeta>/src/payments \| awk '{a+=$1; d+=$2} END {print \"+\"a, \"-\"d}'` |
| **3** | **Métricas CK por archivo** | **Total WMC: 375** (prom. 62.5)<br>WMC máx: 94 (`wompi.ts`)<br>**MAX_CC: 19** (`wompi.ts`, `mercadopago.ts`)<br>CBO prom: 5.67 (máx 8)<br>**Total RFC: 217** (prom. 36.17, máx 48)<br>Violaciones: 5/6 archivos | **Total WMC: 66** (prom. 33.0)<br>WMC máx: 47 (`index.ts`)<br>**MAX_CC: 10** (`index.ts`, cumple umbral DoD)<br>CBO prom: 7.0 (máx 14)<br>**Total RFC: 44** (prom. 22.0, máx 38)<br>Violaciones: 1/2 archivos | **-82.40%** en WMC total<br>**-39.17%** en RFC promedio (36.17 vs 22.00)<br>**-47.37%** en MAX_CC (10 ≤ 10 cumple umbral DoD) | `npm run metrics -- --root ../prototypes/<dir>/src/payments --tsconfig ../prototypes/<dir>/tsconfig.json --unit file --json <file>` |
| **4** | **Conceptos nativos expuestos** | **10 identificadores distintos** y **18 ocurrencias** en código (sin comentarios)<br>(Rapyd: 8 ocur. / 3 dist.; Kushki: 4 ocur. / 3 dist.; Wompi: 4 ocur. / 2 dist.; MP: 2 ocur. / 2 dist.) | **0 identificadores distintos** y **0 ocurrencias** expuestos<br>(Verificado con `--assert-zero`) | **Abstracción hermética al 100%** (0 identificadores y 0 conceptos de pasarela en B) | `npm run metrics:concepts -- --target ../prototypes/<dir>/src/payments` |
| **5** | **Pasarelas alcanzables** | **4 de 4** (100%)<br>Tarjeta y PSE con evidencia de ID en sandboxes y simulador (22 de oct. de 2026, punto 120) | **4 de 4** (100%)<br>Tarjeta y PSE con evidencia de ID en sandboxes y simulador (22 de oct. de 2026, punto 120) | **Paridad funcional completa** (ambos cubren el 100% del alcance fijado) | Ver tabla de IDs de transacción / orden y contexto abajo |
| **6** | **Cobertura de pruebas** | **90.03%** Sentencias<br>**81.08%** Ramas<br>**83.18%** Funciones<br>**96.19%** Líneas<br>(239 pruebas en 10 suites) | **100%** Sentencias<br>**97.59%** Ramas<br>**100%** Funciones<br>**100%** Líneas<br>(165 pruebas en 6 suites) | **+9.97 puntos porcentuales** en Sentencias<br>**+16.51 puntos porcentuales** en Ramas<br>(B tiene 165 pruebas y D 239, 69%, mismo rigor de pruebas) | `npm test -- --coverage --collectCoverageFrom=\"src/payments/**\"` |

---

## 2. Detalle de la Variable 2: Costo de Agregar Cada Pasarela

> [!NOTE]
> Las cifras corresponden a **líneas agregadas y eliminadas del diff** (`git show --numstat`), incluyendo comentarios y líneas en blanco del commit, para no confundirlas con las LOC netas de código de `cloc` de la variable 1.
> Comando reproducible por carpeta:
> `git show --numstat --format= <commit> -- prototypes/<carpeta>/src/payments | awk '{a+=$1; d+=$2} END {print "+"a, "-"d}'`

| Commit / Hito | Prototipo D (Control) | Prototipo B (Tratamiento) | Archivos tocados fuera de pagos |
|---|---|---|---|
| **Wompi inicial**<br>(antes del commit base) | `de8530e` + `b68c9e4` (en `checkout-directo`)<br>`src/payments`: +479 −21 líneas<br>`test/payments`: +886 −23 líneas<br>**Total: +1 365 −44 líneas** | `718b17d` + `e5ce61c` (en `checkout-con-sdk`)<br>`src/payments`: +277 −24 líneas<br>`test/payments`: +422 −42 líneas<br>**Total: +699 −66 líneas** | Ninguno |
| **Commit Base**<br>(soporte multi-pasarela) | `6e4899b` (en `checkout-directo`)<br>`src/payments`: +604 −417 líneas<br>`test/payments`: +50 −1 líneas | `6e4899b` (en `checkout-con-sdk`)<br>`src/payments`: +150 −69 líneas<br>`test/payments`: +83 −13 líneas | 13 archivos simétricos del esqueleto en ambos prototipos |
| **Mercado Pago** | `f335296` (en `checkout-directo`)<br>`src/payments`: +385 −2 líneas<br>`test/payments`: +373 −1 líneas<br>**Total: +758 −3 líneas** | `7b00381` (en `checkout-con-sdk-front-back`)<br>`src/payments`: +18 −1 líneas (`gateways.ts`)<br>`test/payments`: +51 −0 líneas<br>**Total: +69 −1 líneas** | Ninguno (0 archivos fuera) |
| **Kushki** | `ad917db` (en `checkout-directo`)<br>`src/payments`: +338 −2 líneas<br>`test/payments`: +296 −1 líneas<br>**Total: +634 −3 líneas** | `2466495` (en `checkout-con-sdk-front-back`)<br>`src/payments`: +20 −5 líneas<br>`test/payments`: +65 −0 líneas<br>**Total: +85 −5 líneas** | `package.json` (+1 −1) y `package-lock.json` (+4 −4) en ambos |
| **Rapyd** | `ccd54dd` (en `checkout-directo`)<br>`src/payments`: +319 −1 líneas<br>`test/payments`: +287 −1 líneas<br>**Total: +606 −2 líneas** | `daad2aa` (en `checkout-con-sdk-front-back`)<br>`src/payments`: +29 −8 líneas<br>`test/payments`: +121 −0 líneas<br>**Total: +150 −8 líneas** | Ninguno (0 archivos fuera) |
| **Motivo del rechazo**<br>(punto 122) | `d49af66` (en `checkout-sin-solucion`)<br>`src/payments`: +146 −9 líneas<br>`test/payments`: +120 −0 líneas<br>**Total: +266 −9 líneas** | `31fb466` (en `checkout-con-sdk-front-back`)<br>`src/payments`: +9 −0 líneas (`index.ts`)<br>`test/payments`: +28 −0 líneas<br>**Total: +37 −0 líneas** | `package.json` (+1 −1) y `package-lock.json` (+4 −4) en ambos |

### Balance de las tres pasarelas nuevas en `src/payments`:
- **Prototipo D:** 385 (MP) + 338 (Kushki) + 319 (Rapyd) = **1 042 líneas agregadas** (diff: `+1 042 / −5`).
- **Prototipo B:** 18 (MP) + 20 (Kushki) + 29 (Rapyd) = **67 líneas agregadas** (diff: `+67 / −14`).
- **Reducción del esfuerzo:** **93.57%** menos código añadido para soportar las tres nuevas pasarelas en el prototipo con SDK frente a la integración manual directa.

---

## 3. Detalle de la Variable 4: Conceptos Nativos Expuestos

El script `sdk/scripts/native-concepts.ts` remueve los comentarios utilizando el parser oficial de TypeScript (`ts.createSourceFile` y `ts.createPrinter({ removeComments: true })`) antes del conteo, evaluando exclusivamente el código ejecutable y diferenciando **identificadores distintos** de **ocurrencias totales**:

- **Prototipo D (control):** 10 identificadores distintos catalogados y 18 ocurrencias en código:
  - `Public-Merchant-Id`: 2 ocurrencias (`client.js` L85, `kushki.ts` L91)
  - `Private-Merchant-Id`: 1 ocurrencia (`kushki.ts` L92)
  - `x-kushki-signature`: 1 ocurrencia (`kushki.ts` L204)
  - `total_amount`: 1 ocurrencia (`mercadopago.ts` L130)
  - `x-signature`: 1 ocurrencia (`mercadopago.ts` L211)
  - `CLO`: 1 ocurrencia (`rapyd.ts` L44)
  - `salt`: 6 ocurrencias (`rapyd.ts` L104, L107, L113, L205, L205, L209)
  - `access_key`: 1 ocurrencia (`rapyd.ts` L112)
  - `acceptance_token`: 3 ocurrencias (`wompi.ts` L137, L139, L155)
  - `amount_in_cents`: 1 ocurrencia (`wompi.ts` L151)
  *(Nota: 14 ocurrencias brutas adicionales se encontraban en comentarios —como fórmulas SHA256 o explicaciones de `APPROVAL`— y son excluidas).*
- **Prototipo B (tratamiento):** **0 identificadores distintos y 0 ocurrencias** (verificado con `--assert-zero`). La abstracción del SDK oculta al 100% los contratos y detalles propietarios de cada pasarela.

---

## 4. Detalle de la Variable 5: Pasarelas Alcanzables y Evidencias de Cobro

**Fecha y origen de la evidencia:**
Las mediciones contra sandboxes se realizaron el **22 de octubre de 2026** (entre las 19:52 y las 20:05 UTC, con el código de `daad2aa`), bajo el entorno `localtest.me` documentado en el punto 120 del `architecture-log.md`. El flujo PSE de Kushki se validó con el simulador local (punto 121), dado que el entorno UAT oficial de Kushki no transiciona transferencias bancarias a estado final.

| Pasarela | Método | Prototipo D (Control) | Prototipo B (Tratamiento) | Entorno y Referencia |
|---|---|---|---|---|
| **Wompi** | Tarjeta | `12066420-1792698761-45735` | `12066420-1792699478-43077` | Sandbox oficial Wompi (`sandbox.wompi.co`) — 22 oct |
| **Wompi** | PSE | `12066420-1792699420-82005` | `12066420-1792699521-88985` | Sandbox oficial Wompi — 22 oct |
| **Mercado Pago** | Tarjeta | `ORDTST01M5JKARCFRC71T3H34FGAGAJP` | `ORDTST01M5JKGA7Q1JR1PJTNAEMJ809S` | Sandbox oficial Mercado Pago (`localtest.me`) — 22 oct |
| **Mercado Pago** | PSE | `ORDTST01M5JJTYSECYGBJJ2GAGTJ329N` | `ORDTST01M5JJYAPD74JMX525CVFCPX6W` | Sandbox oficial Mercado Pago — 22 oct |
| **Kushki** | Tarjeta | Ticket `169607708835281034` (`APPROVAL`) | Ticket `193524300384999562` (`APPROVAL`) | Sandbox UAT oficial Kushki — 22 oct |
| **Kushki** | PSE | `initializedTransaction` (UAT) / `approvedTransaction` (Sim) | `initializedTransaction` (UAT) / `approvedTransaction` (Sim) | UAT no cierra transferencias; simulador validó con webhook firmado (punto 121) |
| **Rapyd** | Tarjeta | `checkout_28ef91d4bf0491420f55af86f9a551de` | `checkout_e5a177e8e6324e749d23729369fd9684` | Sandbox oficial Rapyd con desafío 3DS — 22 oct |
| **Rapyd** | PSE | `payment_0e22b327ccacc8e50f93035361c224e5` (`CLO`) | `payment_445f7ae11467f8792bf7b54e99a26269` (`CLO`) | Sandbox oficial Rapyd (`sandboxapi.rapyd.net`) — 22 oct |

**Trazabilidad de cambios posteriores en `src/payments`:**
1. **Motivo de rechazo (`d49af66` y `31fb466`, 24 de octubre):** En D se reescribió además la llamada de cobro con tarjeta de Kushki y la lectura del estado de Rapyd para extraer códigos de rechazo.
2. **Re-verificación de tarjeta Kushki (24 de octubre, punto 122):** Se volvió a medir la tarjeta aprobada de Kushki en B y en D tras el ajuste de rechazo.
3. **Ajuste de letras y formatos (`44a897d`):** Modificó exclusivamente comentarios, sin impacto en la funcionalidad ejecutable ni en las LOC de la variable 1.
El resto del comportamiento y la paridad funcional se encuentran plenamente respaldados por las pruebas automatizadas de `src/payments`.
