#!/usr/bin/env node
/**
 * Vigila que la escala tipográfica siga siendo ÚNICA.
 *
 * La app llegó una vez al estado contrario: 147 `font-size` literales repartidos en 17
 * archivos, imposibles de cambiar sin ir uno por uno. Y casi todos en px, que IGNORA el
 * tamaño de letra configurado en el sistema — justo lo que la escala en rem dice respetar.
 *
 * Vive aquí y no en un `.spec.ts` a propósito: el builder de tests de Angular no expone
 * `fs`, y al importar los `.scss` con `?raw` devuelve cadena vacía, así que el test pasaba
 * sin leer nada. Un guardián que no puede fallar no guarda nada.
 *
 * Corre dentro de `npm test`. Suelto: `npm run lint:typography`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const STYLES_FILE = join(SRC, 'styles.scss');

/** `font-size` seguido de lo que sea hasta el `;`, el cierre de bloque o la comilla. */
const FONT_SIZE = /font-size:\s*([^;}"']+)/g;

/**
 * Valores admitidos sin token:
 *  - `inherit`/`unset`: no fijan tamaño, lo delegan.
 *  - `<n>em`: relativo al padre (p. ej. el sufijo «kg» al lado de un número grande).
 *    Sigue escalando con la escala, porque su padre sí lee un token.
 */
const ALLOWED_LITERAL = /^(inherit|unset|[\d.]+em)$/;

const TEXT_TOKENS = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', 'title', 'display'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(scss|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const styles = readFileSync(STYLES_FILE, 'utf8');
const problems = [];

// 1. Nadie declara su propio tamaño.
const literals = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const match of line.matchAll(FONT_SIZE)) {
        const value = match[1].trim();
        if (value.startsWith('var(--fs-')) continue;
        if (ALLOWED_LITERAL.test(value)) continue;
        literals.push(`  ${relative(SRC, file)}:${i + 1} → font-size: ${value}`);
      }
    });
}
if (literals.length) {
  problems.push(
    `${literals.length} font-size fuera de la escala.\n` +
      `Elegí el token más cercano en styles.scss: --fs-2xs..--fs-display para texto,\n` +
      `--fs-num-* para números grandes, --fs-glyph-* para glifos en cajas de tamaño fijo.\n` +
      literals.join('\n'),
  );
}

// 2. Los tokens de texto están en rem y escalan con --fs-scale.
for (const name of TEXT_TOKENS) {
  const declaration = new RegExp(`--fs-${name}:\\s*([^;]+);`).exec(styles);
  if (!declaration) {
    problems.push(`Falta el token --fs-${name} en styles.scss.`);
    continue;
  }
  const value = declaration[1];
  // En px ignoraría el ajuste de accesibilidad del sistema: ese fue el bug original.
  if (!value.includes('rem')) {
    problems.push(`--fs-${name} debe estar en rem, no en px: ${value.trim()}`);
  }
  if (!value.includes('var(--fs-scale)')) {
    problems.push(`--fs-${name} debe multiplicar por var(--fs-scale): ${value.trim()}`);
  }
}

// 3. Nadie fija el tamaño en el root.
// `rem` se mide contra `html`: un font-size ahí reescala TODA la tabla y pisa el ajuste
// del navegador. Estuvo en `html, body` mucho tiempo y dejaba la escala al 87,5 %.
// Sin anclar en `}`: consumirla desalinea el selector de su bloque en la pasada global.
for (const [, rawSelector, declarations] of styles.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
  // Quedarse con lo que sigue al último comentario o declaración: el selector de verdad.
  const selector = rawSelector
    .split(/\*\/|[;]/)
    .pop()
    .trim();
  if (!/(^|[\s,])(html|:root)(\s|,|$)/.test(selector)) continue;
  if (!/(^|[\s;])font-size\s*:/.test(declarations)) continue;
  problems.push(
    `El selector "${selector.replace(/\s+/g, ' ')}" fija font-size en el root.\n` +
      `Ponelo solo en body: en html reescala TODA la tabla de rem (la escala rendía al\n` +
      `87,5 %: --fs-2xs daba 9,6px en vez de 11px) y anula el tamaño de letra que el\n` +
      `usuario configura en el navegador.`,
  );
}

// 4. Todo token usado existe.
const defined = new Set([...styles.matchAll(/^\s*(--fs-[\w-]+):/gm)].map((m) => m[1]));
const used = new Map();
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(/var\((--fs-[\w-]+)\)/g)) {
    if (!used.has(m[1])) used.set(m[1], relative(SRC, file));
  }
}
for (const [token, file] of used) {
  if (!defined.has(token)) problems.push(`Token inexistente ${token} (usado en ${file}).`);
}

if (problems.length) {
  console.error(`\nEscala tipográfica — ${problems.length} problema(s):\n`);
  console.error(problems.join('\n\n'));
  console.error('');
  process.exit(1);
}

console.log(
  `Escala tipográfica: OK (${files.length} archivos, ${used.size} tokens en uso, 0 literales).`,
);
