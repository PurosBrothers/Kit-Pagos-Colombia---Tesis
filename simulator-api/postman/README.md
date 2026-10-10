# Colección de Postman — API de Simulación de Kit Pagos Colombia

Esta carpeta contiene la colección oficial y los entornos versionados de Postman para interactuar con la **API de Simulación** de Kit Pagos Colombia, tanto en entorno local como en el despliegue en la nube (Render).

---

## 📁 Contenido del Directorio

- **`kit-pagos-simulator.postman_collection.json`**: Colección en formato Postman Schema v2.1.0 con carpetas organizadas por responsabilidad:
  1. `00. Diagnóstico`: Endpoint de verificación de salud (`GET /health`).
  2. `01. Capa REST Kit Pagos (/v1/api)`: Los cinco endpoints unificados (`gateways`, `payments`, `payments/:id`, `pse-banks`, `webhooks/:gateway`).
  3. `02. Simulador Wompi (/v1/sim/wompi)`: Rutas de transacciones, tokenización de tarjeta, PSE y términos.
  4. `03. Simulador Mercado Pago (/v1/sim/mercadopago)`: Rutas de pagos, tokenización, órdenes de PSE y métodos de pago.
  5. `04. Simulador Rapyd (/v1/sim/rapyd)`: Rutas de pagos, clientes, checkout hospedado y catálogo PSE.
  6. `05. Simulador Kushki (/v1/sim/kushki)`: Rutas de cobro con tarjeta, tokenización de transferencia, init y consulta.
  7. `06. Webhooks Simulados`: Disparador de eventos salientes (`POST /v1/sim/webhooks/trigger`).
- **`local.postman_environment.json`**: Entorno configurado para el servidor local (`http://localhost:3000`).
- **`render.postman_environment.json`**: Entorno configurado para el despliegue productivo en Render (`https://kit-pagos-colombia.onrender.com`).

---

## 🔐 Política de Seguridad y Credenciales

- **Cero secretos en el repositorio:** La colección y los entornos **no contienen llaves privadas ni credenciales reales**.
- Los endpoints bajo `/v1/api` y el disparador de webhooks requieren autenticación Bearer mediante la variable `{{apiAuthToken}}`.
- En el entorno de Render, la variable `apiAuthToken` se define con valor en blanco para que cada desarrollador o evaluador configure su token de sesión (`API_AUTH_TOKEN`) en memoria sin persistir secretos en el control de versiones.

---

## 🚀 Uso e Importación en Postman

1. Abra Postman y haga clic en **Import**.
2. Seleccione los archivos:
   - `kit-pagos-simulator.postman_collection.json`
   - `local.postman_environment.json`
   - `render.postman_environment.json`
3. En el selector de entornos (esquina superior derecha), elija:
   - **Kit Pagos Simulator - Local** para pruebas locales en `localhost:3000`.
   - **Kit Pagos Simulator - Render (Nube)** para pruebas contra el despliegue de Render.

---

## 🧪 Ejecución Automatizada con Newman (CLI)

Puede ejecutar la colección completa desde la terminal utilizando [Newman](https://www.npmjs.com/package/newman):

### Contra el servidor local:
```bash
npx newman run kit-pagos-simulator.postman_collection.json -e local.postman_environment.json
```

### Contra el despliegue en Render:
```bash
npx newman run kit-pagos-simulator.postman_collection.json \
  -e render.postman_environment.json \
  --env-var "apiAuthToken=TU_TOKEN_AQUI"
```
