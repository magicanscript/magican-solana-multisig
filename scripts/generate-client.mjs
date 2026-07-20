// Generation of a typed JS/TS client from the Anchor IDL via Codama.
//
// Reads target/idl/magican_solana_multisig.json (the new Anchor format with address+discriminators),
// builds the Codama tree and renders a @solana/kit client into clients/js/src/generated/.
//
// Run: yarn generate:client  (or node scripts/generate-client.mjs)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const idlPath = path.join(root, 'target', 'idl', 'magican_solana_multisig.json');
// renderers-js 2.x treats the given folder as the package root: it creates
// package.json itself and lays the code out under src/generated/. Hence we pass clients/js.
const outDir = path.join(root, 'clients', 'js');

const idl = JSON.parse(readFileSync(idlPath, 'utf-8'));

const codama = createFromRoot(rootNodeFromAnchor(idl));
codama.accept(renderVisitor(outDir));

console.log(`✔ Client generated from ${path.relative(root, idlPath)} → ${path.relative(root, outDir)}`);
