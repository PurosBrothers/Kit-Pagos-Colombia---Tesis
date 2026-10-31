# Documentos finales

Fuentes LaTeX de los cuatro documentos que se entregan con el trabajo de grado. Los PDF no se
versionan: se compilan con `latexmk` y pdfLaTeX, en local o en la CI.

| Carpeta | Contenido |
|---|---|
| [`comun/`](comun/) | `estilo.tex`, el formato que comparten el SRS, el SAD y el plan de pruebas (portada, historial de cambios, índices, fuentes y leyendas), y `logo-javeriana.pdf`. |
| [`srs/`](srs/) | Especificación de Requisitos de Software. El contenido lo agrega el [#168](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/168). |
| [`sad/`](sad/) | Descripción de la Arquitectura del Software. El contenido lo agrega el [#170](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/170). |
| [`pruebas/`](pruebas/) | Plan de pruebas según la plantilla PTP. El contenido lo agrega el [#173](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/173). |
| [`memoria/`](memoria/) | Memoria de grado, con su propia plantilla; no usa `comun/`. Qué va en cada capítulo está en [`estructura-documento-final.md`](estructura-documento-final.md). |

## El estilo común

`comun/estilo.tex` reproduce el formato de los PDF originales del SRS y el SAD: hoja carta,
márgenes de una pulgada, cuerpo en TeX Gyre Termes de 10 puntos (el equivalente libre de Times
New Roman) y TeX Gyre Heros para el texto sin serifas (el de Arial). La portada copia la del
SRS y le agrega la versión, como pide la plantilla PTP; esa plantilla también pide el historial
de cambios, que la tabla de contenidos empiece en la Introducción como página 1 y que las listas
de tablas y figuras no entren en ella.

Un documento nuevo arranca así, como [`srs/main.tex`](srs/main.tex):

```latex
\documentclass[10pt]{article}
\input{../comun/estilo}

\NombreDocumento{SRS}
\VersionDocumento{0.1}
\FechaDocumento{octubre de 2026}

\begin{document}

\Portada

\begin{HistorialDeCambios}
  \Cambio{0.1}{28/10/2026}{Portada, historial de cambios e índices con el estilo común (issue \#167).}{Joan Emmanuel Orduz Chia}
\end{HistorialDeCambios}

\Indices

\end{document}
```

El contenido va después de `\Indices`, con `\section`, `\subsection` y `\subsubsection`. Las
leyendas se escriben debajo de la tabla o la figura con `\caption` y salen como «Tabla 1.» y
«Figura 1.», igual que en los originales. Las rutas de `estilo.tex` son relativas a la carpeta
del documento, así que se compila desde ella (eso hace la opción `-cd` de `latexmk`).

Mientras un documento se escribe, la portada y el historial llevan la versión 0.1. Al entregarlo
pasa a 1.0, con la fecha de entrega en `\FechaDocumento`, y cada versión nueva agrega su fila con
`\Cambio`.

## Compilar en local

Hace falta una distribución TeX Live con `latexmk`. Desde la raíz del repositorio:

```bash
latexmk -pdf -interaction=nonstopmode -halt-on-error -cd docs/final-doc/srs/main.tex
```

El PDF queda en `docs/final-doc/srs/main.pdf`, y lo mismo con `sad`, `pruebas` y `memoria`.
`latexmk -C -cd docs/final-doc/srs/main.tex` borra los archivos auxiliares. El `.gitignore` de
esta carpeta ya los excluye, junto con los `main.pdf`.

Con [TinyTeX](https://yihui.org/tinytex/), la variante por omisión (`TinyTeX-1`) no trae todo lo
que usan estos documentos. Estos son los paquetes que hubo que agregar el 28 de octubre de 2026
con TinyTeX v2026.10 (TeX Live 2026, `latexmk` 4.88):

```bash
tlmgr install babel-spanish caption carlisle enumitem fancyhdr hyphen-spanish setspace tex-gyre titlesec titling
fmtutil-sys --byfmt pdflatex
```

`fmtutil-sys` regenera el formato de pdfLaTeX para que incluya los patrones de silabeo del
español; sin ese paso, `babel` avisa que no los encuentra y usa los del inglés. En macOS, TinyTeX
deja los binarios en `~/Library/TinyTeX/bin/universal-darwin`. Si el instalador no los agregó al
PATH, se puede hacer en cada sesión o en `~/.zshrc`:

```bash
export PATH="$HOME/Library/TinyTeX/bin/universal-darwin:$PATH"
```

La CI no necesita esa lista porque usa la imagen [`texlive/texlive:latest`](https://hub.docker.com/r/texlive/texlive),
que trae TeX Live completo. Si algo compila allá y no en local, lo más probable es que falte un
paquete; `tlmgr search --global --file /nombre.sty` dice cuál lo contiene.

## PDF de la CI

El workflow [`final-doc.yml`](../../.github/workflows/final-doc.yml) compila los cuatro
documentos con los mismos comandos cuando un PR hacia `devops` o `main`, o un push a esas ramas,
cambia algo en `docs/final-doc/` o en el propio workflow. Un PR que no toca esas rutas no lo
dispara. Los sube como el artefacto `final-doc-pdf`, con `srs.pdf`, `sad.pdf`, `pruebas.pdf` y
`memoria.pdf`. Se descarga desde la página de la ejecución de «Final documents», en la sección
*Artifacts*, o con `gh run download <id-de-la-ejecución> -n final-doc-pdf`.

## Logo

`comun/logo-javeriana.pdf` es la versión vertical del logo (escudo arriba y la variante
«Colombia» debajo), recortada en vector del archivo `lPUJ Colombia.ai` del
[directorio de insumos gráficos de Educación Continua](https://decrecursos1.javeriana.edu.co/Insumos%20gr%c3%a1ficos%20EduCon/Cabezotes%20Javeriana/Logos%20Javeriana/),
en el dominio `javeriana.edu.co`, consultado el 28 de octubre de 2026 (archivo de 1 881 022 bytes, modificado el 10 de marzo de 2026,
SHA-256 `b4fc8053411d8eea81e1fd18dd1da2867687da39f7209387c34896f48e36000e`). Del archivo
original se quitó la versión horizontal y se recortó el rectángulo (214,83; 193,67)–(385,71;
376,80) en puntos, con PyMuPDF 1.26.5; los trazos y el perfil de color CMYK se conservan.

El logo va en el azul institucional porque el [manual de identidad visual](https://www.javerianacali.edu.co/sites/default/files/2023-01/Manual%20de%20Identidad.pdf)
de la universidad pide esa versión siempre que sea posible, admite el negro al 100 % cuando no se
puede usar el azul y no permite tonos de gris. Los PDF originales usaban una imagen del logo en
escala de grises.
