#!/usr/bin/env sh
# La regla que hace válida la comparación del experimento (prototypes-evaluation-plan.md, §2): todo lo que
# no es el módulo de pagos es idéntico en los dos prototipos. El módulo de pagos es
# src/payments/ y test/payments/; lo demás es el esqueleto común (punto 90 del
# architecture-log.md).
#
# Excepción (puntos 110 y 116): las vitrinas, «La Candelaria Cómics» en D y «La Bodega de
# Chapinero» en B, cada una con su catálogo, su carrito, sus órdenes por líneas y sus pruebas.
# Se excluyen por nombre: src/views/, src/public/, src/orders/, catalog.ts, routes/api.ts y
# routes/pages.ts, y las pruebas checkout.test.ts, orders-and-config.test.ts y catalog.test.ts.
# El servidor, el contrato PaymentsPort, los webhooks, la configuración y las dependencias se
# siguen comparando.
set -eu
cd "$(dirname "$0")"

if ! diff -r \
  --exclude=payments --exclude=node_modules --exclude=coverage --exclude=dist \
  --exclude=views --exclude=public --exclude=orders \
  --exclude=catalog.ts --exclude=api.ts --exclude=pages.ts \
  --exclude=checkout.test.ts --exclude=orders-and-config.test.ts --exclude=catalog.test.ts \
  checkout-sin-solucion checkout-con-sdk-front-back; then
  echo "El esqueleto de los dos prototipos no es idéntico: solo pueden diferir src/payments/, test/payments/ y las vitrinas (puntos 110 y 116)." >&2
  exit 1
fi

# Los dos package.json traen kit-pagos-colombia para que el esqueleto sea idéntico, pero el
# prototipo D integra a mano: su módulo de pagos no puede usar el SDK.
if grep -rnE "kit-pagos-colombia|/vendor/kit-pagos" checkout-sin-solucion/src/payments checkout-sin-solucion/test/payments; then
  echo "El módulo de pagos del prototipo D usa el SDK: D integra la pasarela directamente." >&2
  exit 1
fi

echo "Esqueleto idéntico en los dos prototipos, salvo sus vitrinas, y el módulo de pagos de D no usa el SDK."
