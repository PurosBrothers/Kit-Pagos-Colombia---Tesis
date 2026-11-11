#!/usr/bin/env bash
# Regenera las figuras del SAD y del SPMP desde sus fuentes PlantUML: un PDF vectorial, que es
# el que incluye LaTeX, y en las del SAD también el PNG que se ve en GitHub. Desde la raíz:
#   PLANTUML_JAR=/ruta/plantuml-1.2026.9.jar bash docs/final-doc/diagramas.sh
# Requiere Java 17 o superior, Graphviz (dot; GRAPHVIZ_DOT si no está en el PATH) y Python 3
# con PyMuPDF. El README de esta carpeta explica por qué cada figura se dibuja a 10 puntos.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PLANTUML_JAR:?indique la ruta del jar de PlantUML en PLANTUML_JAR}"
JAVA="${JAVA:-java}"
PYTHON="${PYTHON:-python3}"
export PLANTUML_LIMIT_SIZE="${PLANTUML_LIMIT_SIZE:-16384}"

SDK=docs/architecture/SDK
SIM="docs/architecture/Simulador API"
SPMP=docs/final-doc/spmp/figuras

# fuente|salida sin extensión|png o nada
FIGURAS=(
  "$SDK/diagrams-source/domain-class-diagram.puml|$SDK/Domain Class Diagram|png"
  "$SDK/diagrams-source/context-diagram.puml|$SDK/Context Diagram - C4|png"
  "$SDK/diagrams-source/container-diagram.puml|$SDK/Container Diagram - C4|png"
  "$SDK/diagrams-source/component-diagram.puml|$SDK/Component Diagram - C4|png"
  "$SDK/diagrams-source/sequence-payment-creation.puml|$SDK/Sequence Diagram - Payment Creation|png"
  "$SDK/diagrams-source/sequence-synchronous-payment.puml|$SDK/Sequence Diagram - Synchronous Payment|png"
  "$SDK/diagrams-source/sequence-webhook-conciliation.puml|$SDK/Sequence Diagram - Webhook Conciliation|png"
  "$SDK/diagrams-source/sequence-sdk-code-orchestration.puml|$SDK/Sequence Diagram - SDK Code Orchestration|png"
  "$SDK/diagrams-source/hexagonal-architecture-class-diagram.puml|$SDK/Hexagonal architecture class diagram|png"
  "$SIM/diagrams-source/domain-class-diagram.puml|$SIM/diagrama-clases-dominio-simulacion|png"
  "$SIM/diagrams-source/context-diagram.puml|$SIM/Context Diagram - C4|png"
  "$SIM/diagrams-source/container-diagram.puml|$SIM/Container Diagram - C4|png"
  "$SIM/diagrams-source/component-diagram.puml|$SIM/Component Diagram - C4|png"
  "$SIM/diagrams-source/sequence-successful-payment.puml|$SIM/Sequence Diagram - Successful Payment|png"
  "$SIM/diagrams-source/sequence-denied-payment.puml|$SIM/Sequence Diagram - Denied Payment|png"
  "$SIM/diagrams-source/sequence-network-error.puml|$SIM/Sequence Diagram - Network Error|png"
  "$SIM/diagrams-source/sequence-webhook-notification.puml|$SIM/Sequence Diagram - Webhook Notification|png"
  "$SIM/diagrams-source/deploy-diagram.puml|$SIM/Deploy Diagram - C4|png"
  "$SPMP/diagrams-source/01-ciclo-de-vida.puml|$SPMP/01-ciclo-de-vida|"
  "$SPMP/diagrams-source/02-organigrama.puml|$SPMP/02-organigrama|"
  "$SPMP/diagrams-source/04-bpmn-iterativo.puml|$SPMP/04-bpmn-iterativo|"
  "$SPMP/diagrams-source/05-bpmn-requerimientos.puml|$SPMP/05-bpmn-requerimientos|"
  "$SPMP/diagrams-source/06-bpmn-riesgos.puml|$SPMP/06-bpmn-riesgos|"
  "$SPMP/diagrams-source/07-bpmn-documentacion.puml|$SPMP/07-bpmn-documentacion|"
  "$SPMP/diagrams-source/08-bpmn-calidad.puml|$SPMP/08-bpmn-calidad|"
)

plantuml() {
  "$JAVA" -Djava.awt.headless=true -jar "$PLANTUML_JAR" -charset UTF-8 "$@"
}

svg="$(mktemp)"
trap 'rm -f "$svg"' EXIT
for figura in "${FIGURAS[@]}"; do
  IFS='|' read -r fuente salida png <<< "$figura"
  plantuml -tsvg -pipe < "$fuente" > "$svg"
  # MuPDF dibuja Helvetica con Nimbus Sans, de métricas iguales: el texto no se sale de las cajas.
  "$PYTHON" - "$svg" "$salida.pdf" <<'PY'
import sys
import fitz

svg, pdf = sys.argv[1:]
doc = fitz.open("pdf", fitz.open(svg, filetype="svg").convert_to_pdf())
doc.set_metadata({})
doc.save(pdf, garbage=4, deflate=True, no_new_id=True)
PY
  if [ "$png" = png ]; then
    plantuml -tpng -pipe < "$fuente" > "$salida.png"
  fi
  echo "$salida.pdf"
done
