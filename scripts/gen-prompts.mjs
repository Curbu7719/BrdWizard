/**
 * Regenerate supabase/functions/_shared/prompts/index.ts from the .md files.
 *
 * The Supabase Edge bundler supports neither runtime file reads (the .md files
 * are not bundled) nor `import ... with { type: 'text' }`. So the prompt text
 * is embedded into a generated .ts module as JS string literals (JSON.stringify
 * keeps it safe regardless of backticks / ${} in the content).
 *
 * Run after editing any prompt .md:
 *   node scripts/gen-prompts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.resolve(
  __dirname,
  '../supabase/functions/_shared/prompts'
);

const files = {
  platformLayerText: 'platform-layer.md',
  agentSkillText: 'brd-agent-skill.md',
  channelMappingText: 'channel-mapping.md',
};

let out =
  '/**\n * AUTO-GENERATED from the .md files in this directory.\n' +
  ' * Do NOT edit by hand — edit the .md files and regenerate:\n' +
  ' *   node scripts/gen-prompts.mjs\n' +
  ' * Embedded as JS string literals because the Supabase Edge bundler\n' +
  ' * supports neither runtime file reads nor text-import attributes.\n */\n\n';

for (const [name, file] of Object.entries(files)) {
  const content = fs.readFileSync(path.join(promptsDir, file), 'utf8');
  out += `export const ${name} = ${JSON.stringify(content)};\n\n`;
}

fs.writeFileSync(path.join(promptsDir, 'index.ts'), out);
console.log('Wrote', path.join(promptsDir, 'index.ts'));
