# Ejemplos de integración — Kit Pagos Colombia

Esta carpeta es un paquete npm independiente que **no forma parte del SDK**. Existe para demostrar la integración desde afuera: declara `kit-pagos-colombia` como dependencia y lo importa por su nombre público, exactamente como lo haría un comercio que lo instalara desde npm.

Esa separación es deliberada. Si el ejemplo viviera dentro de `sdk/src` e importara por rutas relativas, probaría el código interno pero no demostraría nada sobre lo que el paquete publicado realmente expone. Al consumirlo como dependencia, cualquier tipo o clase que falte en la superficie pública rompe la compilación del ejemplo de inmediato.

## Cómo correr el ejemplo

Necesitas tres terminales, o correr los dos primeros pasos una sola vez.

**1. Compilar el SDK.** El paquete apunta a `dist/index.js` y `dist/index.d.ts`, así que hay que construirlo antes de consumirlo.

```bash
cd sdk
npm install
npm run build
```

**2. Levantar la API de Simulación.** El ejemplo hace peticiones HTTP reales contra el mock de Wompi en el puerto 3000. Dejala corriendo.

```bash
cd simulator-api
npm install
npm run dev
```

**3. Instalar y correr el ejemplo.**

```bash
cd examples
npm install
npm start
```

## Qué deberías ver

El script imprime la solicitud de pago construida con objetos de valor del dominio, la `Transaction` que devuelve el SDK con estado `APPROVED`, y luego un error tipado con código `UNSUPPORTED_OPERATION` al intentar consultar el estado, porque la API de Simulación todavía no expone ese endpoint. Ese último bloque está en el ejemplo a propósito: muestra cómo el comercio distingue por código qué fue lo que pasó, en lugar de leer un mensaje de texto.

Si la API de Simulación no está arriba, el ejemplo lo detecta por el código `CONNECTION_FAILED` y te dice qué comando correr.

## Verificar los tipos sin ejecutar

```bash
npm run typecheck
```

Esto compila el ejemplo contra los `.d.ts` del SDK ya construido, así que sirve para detectar si un cambio en el SDK rompió su superficie pública sin necesidad de levantar el simulador.

## Nota sobre el pipeline

El CI del repositorio solo tiene trabajos para `sdk` y `simulator-api`, así que esta carpeta no se verifica automáticamente. Si cambias la superficie pública del SDK, corré `npm run typecheck` acá a mano antes de abrir el pull request.
