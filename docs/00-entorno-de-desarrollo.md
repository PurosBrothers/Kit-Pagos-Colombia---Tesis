# Entorno de desarrollo: cómo se levanta y cómo se verifica

Este documento es lo primero que hay que leer para poder ejecutar cualquier cosa del repositorio. Explica qué hay dentro, qué se instala, en qué orden se arranca cada pieza y con qué comandos se verifica un cambio antes de abrir un pull request. No explica arquitectura ni lógica de negocio: para eso están las secciones [01-producto](01-producto/) y [02-arquitectura](02-arquitectura/).

> **Nota de historial.** Este archivo reemplaza a `docs/architecture/setup-and-structure.md`, el documento de arranque más antiguo del repositorio, que describía una estructura de carpetas en español (`domain/enums/EstadoTransaccion.ts`, `domain/interfaces/IPuertoPasarela.ts`, `application/KitPagos.ts`) que nunca llegó a existir. El punto 8 del [architecture-log](architecture/architecture-log.md) registraba esa deuda; queda cerrada con esta reescritura.

---

## 1. Qué hay en el repositorio

El proyecto es un monorepo. Kit Pagos Colombia se entrega como **tres componentes**, y hay dos carpetas más que existen para soportarlos:

| Carpeta | Qué es | Se entrega |
|---|---|---|
| `sdk/` | La librería TypeScript, publicada en npm como `kit-pagos-colombia` | Componente 1 |
| `simulator-api/` | La API de Simulación: un servidor Fastify que imita a las cuatro pasarelas | Componente 2 |
| `docs/testing-data/` | La documentación de datos de prueba de cada pasarela | Componente 3 |
| `examples/` | Paquete npm independiente que consume el SDK como lo haría un comercio | Soporte |
| `docs/` | Toda la documentación del proyecto, incluida esta | Soporte |

Los tres componentes no son tres carpetas que casualmente conviven: el SDK no se puede ejercitar sin un servidor al que llamar, y ni el SDK ni el simulador se pueden ejercitar sin saber qué tarjeta, qué banco y qué documento usar en cada pasarela. Eso está explicado en [01-producto/4-por-que-kit-pagos.md](01-producto/4-por-que-kit-pagos.md).

Cada paquete de código tiene su propio `package.json` y su propio `node_modules`. No hay workspaces de npm: se instala por carpeta.

---

## 2. Requisitos

- **Node.js 20 o superior.** El CI corre sobre Node 20, así que ese es el piso garantizado. El SDK compila a `ES2020` y declara compatibilidad desde Node 18, pero el desarrollo se hace en 20.
- **npm.** No se usa yarn ni pnpm en el repositorio; el `package-lock.json` versionado es de npm.
- **Git.** Con la política de ramas de [CONTRIBUTING.md](../CONTRIBUTING.md): las ramas de trabajo salen de `devops`, no de `main`.

No se necesita nada más. Para lo que sí hace falta credenciales reales —las pruebas de contrato contra los sandboxes— ver la sección 6.

---

## 3. Puesta en marcha, en cuatro pasos

El orden importa: el paquete de ejemplos consume el SDK desde `dist/`, así que si el SDK no está compilado, los ejemplos no arrancan.

```bash
# 1. El SDK: instalar y compilar
cd sdk && npm install && npm run build

# 2. La API de Simulación: instalar y dejarla corriendo en su propia terminal
cd simulator-api && npm install && npm run dev
#    Queda escuchando en http://localhost:3000 — probalo con GET /health

# 3. Los ejemplos: instalar en otra terminal
cd examples && npm install

# 4. Correr cualquier ejemplo
npm run simulate:wompi
```

Dos cosas que conviene entender de este arranque, porque explican casi todos los errores de la primera vez:

- **`sdk/dist/` no está versionado.** Está en `.gitignore` y se genera con `npm run build`. Si acabás de clonar el repositorio, o si alguien cambió la superficie pública del SDK, hay que reconstruir antes de correr los ejemplos o el `typecheck`. Un `dist/` viejo hace que el `typecheck` de los ejemplos pase contra una API que ya no existe, y eso ya pasó.
- **El paquete de ejemplos depende del SDK por ruta de archivo** (`"kit-pagos-colombia": "file:../sdk"`) y lo importa **por su nombre público**, nunca por rutas relativas hacia `sdk/src`. Es deliberado: así cualquier tipo que falte en `sdk/src/index.ts` rompe la compilación de los ejemplos de inmediato. Fue así como se descubrió que faltaban cuatro tipos en la superficie pública (punto 21 del architecture-log).

---

## 4. Qué script hace qué

### `sdk/`

| Comando | Qué hace |
|---|---|
| `npm test` | Las pruebas unitarias con Jest. Excluye las de sandbox. Umbral de cobertura del 80 % en ramas, funciones, líneas y sentencias |
| `npm run test:sandbox` | Las pruebas de contrato contra los sandboxes reales. Necesita credenciales; sin ellas se saltan solas |
| `npm run lint` | ESLint sobre todo el paquete |
| `npm run build` | Borra `dist/` y compila con `tsconfig.build.json` (el de producción, que excluye las pruebas) |
| `npm run metrics` | Las métricas CK (WMC, CBO, RFC, MAX_CC) con `ts-morph`. Sale con código 1 si alguna clase viola un umbral |
| `npm run check:readme` | Extrae los bloques TypeScript del `README.md` y los compila contra `dist/`. **Requiere haber corrido `build` antes** |
| `npm run check:published` | Instala `kit-pagos-colombia` desde npm en un directorio temporal y compila un programa contra él. Necesita red, y verifica lo publicado, no el árbol de trabajo |

### `simulator-api/`

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta el servidor con `ts-node-dev`, que reinicia solo al guardar |
| `npm test` | Las pruebas de las rutas, con `app.inject()` de Fastify (no abre puerto) |
| `npm run lint` | ESLint |
| `npm run build` y `npm start` | Compilar y correr la versión compilada, que es como se despliega |

### `examples/`

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | `tsc --noEmit` contra los tipos publicados del SDK. No necesita el simulador |
| `npm run simulate:*` | Cada uno de los diez ejemplos. Todos necesitan el simulador corriendo |

Los diez comandos de simulación están listados uno por uno, con qué imprime cada uno, en [05-ejemplos/README.md](05-ejemplos/README.md).

---

## 5. Cómo se verifica un cambio antes del pull request

Este es el bloque completo. Si algo de acá falla, el cambio no está listo, y no alcanza con que "las pruebas pasen": el `build` y el `typecheck` de los ejemplos son los que detectan que se rompió la superficie pública del paquete.

```bash
cd sdk && npx jest && npm run lint && npm run metrics && npm run build && npm run check:readme
cd simulator-api && npx jest
cd examples && npm run typecheck
```

Y si el cambio toca un adaptador, además hay que correr el ejemplo correspondiente contra el simulador. No es ceremonia: ejecutar contra el simulador y contra los sandboxes reales encontró defectos que las pruebas unitarias no veían, y está documentado en los puntos 43, 44, 48, 50 y 52 del architecture-log. El caso más claro es el punto 52: dos ramas que pasaban sus pruebas por separado rompieron el ejemplo de intercambiabilidad al fusionarse, y el `typecheck` no lo vio porque el error era de comportamiento, no de tipos.

### Qué corre en CI y qué no

El CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) tiene dos trabajos, ambos sobre Node 20:

- **sdk:** `npm ci` → `lint` → `test -- --coverage` → `build` → `npm pack --dry-run`.
- **simulator-api:** `npm ci` → `lint` → `test -- --coverage`.

**Fuera de CI quedan cuatro cosas**, y hay que correrlas a mano: `npm run metrics`, `npm run check:readme`, `npm run test:sandbox` y todo lo de `examples/`. Vale la pena saberlo porque un pull request puede estar verde en GitHub y romper igual una métrica CK o un fragmento del README.

---

## 6. El `.env` de la raíz

En la raíz hay un `.env.example` que se copia a `.env` (que está en `.gitignore` y nunca se sube). Tiene dos secciones con propósitos distintos:

1. **Credenciales de los paneles** de cada proveedor. Son para administrar las cuentas y sacar las llaves; el código no las usa.
2. **Llaves de sandbox de cada pasarela.** Estas sí las lee el código: son las que activan `npm run test:sandbox` en el SDK.

Si el `.env` no tiene llaves de una pasarela, sus pruebas de contrato **se saltan en silencio en lugar de fallar**. Eso es a propósito, para que cualquiera pueda correr la suite completa sin credenciales, pero tiene una trampa: una suite que se salta entera se ve igual de verde que una que pasa. Cuando importe, hay que leer la salida y confirmar que corrió.

El detalle de qué variable corresponde a qué credencial de qué panel está en [03-sdk/4-guia-de-implementacion.md](03-sdk/4-guia-de-implementacion.md), que es la misma configuración que necesitaría un comercio.

---

## 7. Decisiones de entorno que conviene conocer

**El SDK no usa ningún framework.** No hay NestJS ni Express, porque el SDK es una librería: no administra rutas, no levanta un servidor y no tiene ciclo de vida propio. Solo TypeScript, con una única dependencia de producción (`big.js`, para la aritmética decimal exacta). Cada dependencia que un SDK arrastra es una dependencia que le imponemos al comercio, y esa es la razón de fondo para mantener la lista en uno.

**TypeScript en modo estricto, apuntando a ES2020.** `strict: true`, `noImplicitAny`, `strictNullChecks`. La compilación de producción usa un `tsconfig.build.json` aparte que excluye las pruebas, para que los `.d.ts` publicados no arrastren tipos de Jest.

**Fastify en el simulador, no Express.** Es liviano, rinde bien y valida con JSON Schema, que es cómodo para armar escenarios controlados. Sus pruebas usan `app.inject()`, así que corren sin abrir un puerto y sin quedar colgadas esperando la red.

**`ts-node-dev` en vez de `tsx` para el simulador.** Este cambio salió de un problema real y no de una preferencia: `tsx` depende de binarios de `esbuild`, y en el entorno Windows de uno de los integrantes eso daba `EPERM` y `Expected "0.28.1" but got "0.20.2"`, con archivos bloqueados dentro de `node_modules` y OneDrive sincronizando la carpeta en el medio. Limpiar caché no lo resolvió de forma estable, así que se reemplazó la herramienta. Los ejemplos sí usan `tsx`, porque ahí no dio problema.

**El `tsconfig.json` del SDK se escribió a mano.** `npx tsc --init` fallaba por un paquete nativo de TypeScript para Windows (`@typescript/typescript-win32-x64`). Escribirlo a mano además permitió dejar el modo estricto desde el primer commit, en vez de encenderlo después cuando ya cuesta.

---

## 8. Dónde seguir

- Si nunca viste el proyecto: [README de la documentación](README.md), que tiene el camino de lectura completo.
- Si vas a tocar el SDK: [03-sdk/2-clase-por-clase.md](03-sdk/2-clase-por-clase.md).
- Si vas a tocar el simulador: [02-arquitectura/3-api-de-simulacion.md](02-arquitectura/3-api-de-simulacion.md).
- Si vas a abrir un pull request: [CONTRIBUTING.md](../CONTRIBUTING.md).
