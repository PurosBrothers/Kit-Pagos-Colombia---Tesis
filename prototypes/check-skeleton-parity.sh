#!/usr/bin/env sh
# La regla que hace válida la comparación A/B (prototypes-evaluation-plan.md, §2): todo lo que
# no es el módulo de pagos es idéntico en los dos prototipos. El módulo de pagos es
# src/payments/ y test/payments/; lo demás es el esqueleto común (punto 90 del
# architecture-log.md).
set -eu
cd "$(dirname "$0")"

if ! diff -r \
  --exclude=payments --exclude=node_modules --exclude=coverage --exclude=dist \
  checkout-directo checkout-con-sdk; then
  echo "El esqueleto de los dos prototipos no es idéntico: solo pueden diferir src/payments/ y test/payments/." >&2
  exit 1
fi

# Los dos package.json traen kit-pagos-colombia para que el esqueleto sea idéntico, pero el
# prototipo A integra a mano: su módulo de pagos no puede usar el SDK.
if grep -rnE "kit-pagos-colombia|/vendor/kit-pagos" checkout-directo/src/payments checkout-directo/test/payments; then
  echo "El módulo de pagos del prototipo A usa el SDK: A integra la pasarela directamente." >&2
  exit 1
fi

echo "Esqueleto idéntico en los dos prototipos, y el módulo de pagos de A no usa el SDK."
