// Генерация типизированного JS/TS-клиента из Anchor-IDL через Codama.
//
// Читает target/idl/magican_solana_multisig.json (новый Anchor-формат с address+дискриминаторами),
// строит дерево Codama и рендерит клиент на @solana/kit в clients/js/src/generated/.
//
// Запуск: yarn generate:client  (или node scripts/generate-client.mjs)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const idlPath = path.join(root, 'target', 'idl', 'magican_solana_multisig.json');
// renderers-js 2.x трактует переданную папку как корень пакета: сам создаёт
// package.json и раскладывает код под src/generated/. Поэтому передаём clients/js.
const outDir = path.join(root, 'clients', 'js');

const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));

const codama = createFromRoot(rootNodeFromAnchor(idl));
codama.accept(renderVisitor(outDir));

console.log(`✔ Клиент сгенерирован из ${path.relative(root, idlPath)} → ${path.relative(root, outDir)}`);
