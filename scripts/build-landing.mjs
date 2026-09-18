import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Conserva o artefato original entregue pelo design em docs/.
const source = new URL('../docs/S2Cam Landing.html', import.meta.url);
const output = new URL('../infra/gateway/landing/dist/', import.meta.url);
let html = await readFile(source, 'utf8');
const templatePattern = /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;
const match = html.match(templatePattern);
if (!match) throw new Error('Template da landing não encontrado.');
let template = JSON.parse(match[2]);
const metadata = '<title>S2Cam — Videomonitoramento inteligente</title><meta name="description" content="Conheça a plataforma S2Cam de videomonitoramento, gravações e alertas."><link rel="canonical" href="https://s2cam.com.br/">';
template = template.replace('<html>', '<html lang="pt-BR">').replace('<head>', '<head>' + metadata);
template = template.replace(/<a href="#contato"([^>]*)>Acessar sistema<\/a>/g,
  '<a href="https://central.s2cam.com.br/"$1>Acessar Central</a>');
html = html.replace(templatePattern, (_, start, _template, end) => start + JSON.stringify(template).replace(/<\//g, '<\\/') + end);
html = html.replace('<html>', '<html lang="pt-BR">')
  .replace('<title>Bundled Page</title>', metadata + '<meta name="viewport" content="width=device-width, initial-scale=1">');
await mkdir(output, { recursive: true });
await writeFile(new URL('index.html', output), html);
console.log(fileURLToPath(new URL('index.html', output)));
