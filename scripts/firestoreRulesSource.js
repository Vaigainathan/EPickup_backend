const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RULES_START = '// Marketplace orders';
const RULES_END = '// Default rule';

function normalizeRules(text) {
  return `${String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()}\n`;
}

function textDiff(left, right) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-diff-'));
  const leftPath = path.join(dir, 'deployed.rules');
  const rightPath = path.join(dir, 'local.rules');
  fs.writeFileSync(leftPath, normalizeRules(left));
  fs.writeFileSync(rightPath, normalizeRules(right));
  const result = spawnSync('git', ['diff', '--no-index', '--', leftPath, rightPath], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (result.status === 0) {
    return '';
  }
  return result.stdout || result.stderr || '';
}

function splitMarketplace(text) {
  const normalized = normalizeRules(text);
  const start = normalized.indexOf(RULES_START);
  const end = normalized.indexOf(RULES_END);
  if (start < 0 || end < start) {
    return null;
  }
  return {
    before: normalized.slice(0, start),
    block: normalized.slice(start, end),
    after: normalized.slice(end)
  };
}

function marketplaceRulesDiff(deployed, local) {
  const left = splitMarketplace(deployed);
  const right = splitMarketplace(local);
  if (!left || !right) {
    return { ok: false, reason: 'Could not find the marketplaceOrders section' };
  }
  if (left.before !== right.before || left.after !== right.after) {
    return { ok: false, reason: 'Deployed rules differ outside marketplaceOrders' };
  }
  return { ok: true, blockChanged: left.block !== right.block };
}

async function fetchDeployedFirestoreRules(projectId) {
  require('dotenv').config();
  const admin = require('firebase-admin');
  require('../src/services/firebase').getFirestore();
  const tokenResult = await admin.app().options.credential.getAccessToken();
  const accessToken = tokenResult && (tokenResult.access_token || tokenResult.accessToken);
  if (!accessToken) {
    throw new Error('Could not get an access token for the Rules API');
  }
  const headers = { Authorization: `Bearer ${accessToken}` };
  const releaseUrl = `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`;
  const releaseResponse = await fetch(releaseUrl, { headers });
  if (!releaseResponse.ok) {
    throw new Error(`Rules release lookup failed (${releaseResponse.status})`);
  }
  const release = await releaseResponse.json();
  if (!release.rulesetName) {
    throw new Error('Rules release has no ruleset');
  }
  const rulesetResponse = await fetch(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, { headers });
  if (!rulesetResponse.ok) {
    throw new Error(`Ruleset lookup failed (${rulesetResponse.status})`);
  }
  const ruleset = await rulesetResponse.json();
  const files = ruleset.source && Array.isArray(ruleset.source.files) ? ruleset.source.files : [];
  const file = files.find((item) => item.name === 'firestore.rules') || files[0];
  if (!file || typeof file.content !== 'string') {
    throw new Error('Ruleset has no firestore.rules source');
  }
  return file.content;
}

module.exports = {
  RULES_START,
  normalizeRules,
  textDiff,
  splitMarketplace,
  marketplaceRulesDiff,
  fetchDeployedFirestoreRules
};
