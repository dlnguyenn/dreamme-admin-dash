#!/usr/bin/env node
// Patches the "Telegram: Send Caption" node so its chatId reads from the
// persona data in "Assemble Content Package" instead of $json.result.chat.id
// (which is the preceding node's response, not a Telegram sendPhoto response).
//
// Why this matters: with the broken expression, Telegram: Send Caption errors
// out; because onError is continueErrorOutput, main[0] emits nothing; the
// Split In Batches loop-back is wired through main[0], so the loop never
// advances past persona 1.
//
// Usage (from your Windows machine, where n8n runs):
//   set N8N_API_KEY=your-personal-api-key
//   node n8n/patch-loopback.js
// or pass the key as the first arg:
//   node n8n/patch-loopback.js your-personal-api-key
//
// After this runs successfully the workflow is saved as a DRAFT. You still
// need to click "Publish" in the n8n UI (or POST the publish endpoint) for
// the scheduled trigger to use the new version.

const WORKFLOW_ID = 'aeZXtk3TFZ7Pk6Kc';
const BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5678';
const API_KEY = process.env.N8N_API_KEY || process.argv[2];
const TARGET_NODE = 'Telegram: Send Caption';
const NEW_CHAT_ID = "={{ $('Assemble Content Package').item.json.telegramChatId }}";

if (!API_KEY) {
  console.error('Missing API key.');
  console.error('  set N8N_API_KEY=...   (or pass as arg)');
  console.error('  node n8n/patch-loopback.js <api-key>');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'X-N8N-API-KEY': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${method} ${path} -> HTTP ${res.status}`);
    console.error(text.slice(0, 2000));
    process.exit(1);
  }
  return text ? JSON.parse(text) : null;
}

(async () => {
  console.log(`GET ${BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`);
  const wf = await api('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  console.log(`  name: ${wf.name}`);
  console.log(`  nodes: ${wf.nodes.length}   versionId: ${wf.versionId}`);

  const node = wf.nodes.find(n => n.name === TARGET_NODE);
  if (!node) {
    console.error(`Node "${TARGET_NODE}" not found.`);
    process.exit(1);
  }

  const before = node.parameters.chatId;
  console.log(`\n${TARGET_NODE}.chatId`);
  console.log(`  before: ${before}`);
  console.log(`  after:  ${NEW_CHAT_ID}`);
  if (before === NEW_CHAT_ID) {
    console.log('Already patched. Nothing to do.');
    return;
  }
  node.parameters.chatId = NEW_CHAT_ID;

  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || { executionOrder: 'v1' },
  };

  console.log(`\nPUT ${BASE_URL}/api/v1/workflows/${WORKFLOW_ID}`);
  const result = await api('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, body);
  console.log(`  saved. new versionId: ${result && result.versionId}`);
  console.log('\nDraft saved. Open the workflow in the n8n UI and click "Publish"');
  console.log('to activate the fix for the scheduled trigger and new runs.');
})();
