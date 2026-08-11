#!/usr/bin/env node
// Traduz um stack de produção (minificado) em linhas de código de verdade.
//
// POR QUE EXISTE: erro relatado por usuário chega como
// "at $i (index-BRrnR2kS.js:17:62435)", que não aponta nada. Desde v1.13.2 o
// build publica sourcemap, então esses números TÊM tradução — este script faz a
// tradução, baixando o mapa do próprio site.
//
// USO:  cole o stack na entrada padrão.
//   pbpaste | node scripts/mapear-stack.mjs
//   node scripts/mapear-stack.mjs < erro.txt
//   node scripts/mapear-stack.mjs --dist frontend/dist   (mapa local, sem rede)
//
// ATENÇÃO: só funciona enquanto aquele bundle ainda estiver no ar. Deploy novo
// troca o nome do arquivo e apaga o antigo — se o stack for de um deploy
// passado, não há mapa para buscar. Peça um print/stack novo.
import { SourceMap } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SITE = process.env.TASKHS_URL ?? "https://taskhs.healthsafetytech.com";
const distIdx = process.argv.indexOf("--dist");
const dist = distIdx > -1 ? process.argv[distIdx + 1] : null;

const entrada = readFileSync(0, "utf8");
// "arquivo.js:linha:coluna" em qualquer formato de stack
const posicoes = [...entrada.matchAll(/([\w.-]+\.js):(\d+):(\d+)/g)];
if (posicoes.length === 0) {
  console.error("Nenhuma posição no formato arquivo.js:linha:coluna encontrada na entrada.");
  process.exit(1);
}

const mapas = new Map();
async function mapaDe(arquivo) {
  if (mapas.has(arquivo)) return mapas.get(arquivo);
  let bruto = null;
  if (dist) {
    const caminho = join(dist, "assets", `${arquivo}.map`);
    if (existsSync(caminho)) bruto = readFileSync(caminho, "utf8");
    else console.error(`  (sem mapa para ${arquivo} em ${dist}/assets — build diferente do que gerou o stack)`);
  } else {
    const r = await fetch(`${SITE}/assets/${arquivo}.map`);
    if (r.ok) bruto = await r.text();
    else console.error(`  (sem mapa para ${arquivo}: HTTP ${r.status} — deploy trocado?)`);
  }
  const sm = bruto ? new SourceMap(JSON.parse(bruto)) : null;
  mapas.set(arquivo, sm);
  return sm;
}

for (const [texto, arquivo, linha, coluna] of posicoes) {
  const sm = await mapaDe(arquivo);
  if (!sm) { console.log(`${texto}  ->  ?`); continue; }
  const e = sm.findEntry(Number(linha) - 1, Number(coluna));
  const origem = e?.originalSource?.replace(/^(\.\.\/)+/, "") ?? "?";
  // node_modules polui: o que interessa é onde o NOSSO código aparece.
  const nosso = origem.startsWith("src/") ? " <<<" : "";
  console.log(`${texto}  ->  ${origem}:${e?.originalLine + 1}:${e?.originalColumn}${nosso}`);
}
