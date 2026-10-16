// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `npm run check:sri`: descarga cada módulo que el import map de `index.html` protege con un
 * hash, y comprueba que el hash sea el del archivo que sirve la CDN y que el módulo no importe
 * otro sin hash. Necesita red, y por eso no corre con `npm test`; se corre al cambiar la versión
 * del SDK en `src/tokenizer.ts`.
 */

const IMPORT_MAP = /<script type="importmap">([\s\S]*?)<\/script>/;
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/**
 * @typedef {object} ImportMap
 * @property {Record<string, string>} [imports]
 * @property {Record<string, string>} [integrity]
 */

/**
 * @param {string} html
 * @returns {ImportMap}
 */
export function readImportMap(html) {
  const match = IMPORT_MAP.exec(html);
  if (!match) {
    throw new Error('index.html no tiene <script type="importmap">.');
  }
  return JSON.parse(match[1]);
}

/** @param {Uint8Array | string} content */
export function sha384(content) {
  return `sha384-${createHash("sha384").update(content).digest("base64")}`;
}

/**
 * Las URL que un módulo importa, resueltas contra la suya. Es una búsqueda por texto: puede
 * dar de más, nunca de menos, y lo que dé de más se revisa a mano.
 *
 * @param {string} source
 * @param {string} moduleUrl
 */
export function importedUrls(source, moduleUrl) {
  return [...source.matchAll(IMPORT_SPECIFIER)].map(([, specifier]) => new URL(specifier, moduleUrl).href);
}

/**
 * @param {string} html
 * @param {(url: string) => Promise<Response>} [fetchFn]
 * @returns {Promise<{ verified: string[], problems: string[] }>}
 */
export async function checkIntegrity(html, fetchFn = fetch) {
  const integrity = readImportMap(html).integrity ?? {};
  const urls = Object.keys(integrity);
  if (urls.length === 0) {
    return { verified: [], problems: ["El import map no tiene ninguna entrada en «integrity»."] };
  }

  /** @type {string[]} */
  const verified = [];
  /** @type {string[]} */
  const problems = [];
  for (const url of urls) {
    const response = await fetchFn(url);
    if (!response.ok) {
      problems.push(`${url}: la CDN respondió ${response.status}.`);
      continue;
    }
    const content = new Uint8Array(await response.arrayBuffer());
    const served = sha384(content);
    if (served !== integrity[url]) {
      problems.push(`${url}: index.html espera ${integrity[url]} y la CDN sirve ${served}.`);
    } else {
      verified.push(`${url} ${served}`);
    }
    for (const imported of importedUrls(new TextDecoder().decode(content), url)) {
      if (!(imported in integrity)) {
        problems.push(`${url} importa ${imported}, que no tiene hash en el import map.`);
      }
    }
  }
  return { verified, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
    const { verified, problems } = await checkIntegrity(html);
    for (const line of verified) {
      console.log(`Coincide: ${line}`);
    }
    for (const line of problems) {
      console.error(`No coincide: ${line}`);
    }
    process.exitCode = problems.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
