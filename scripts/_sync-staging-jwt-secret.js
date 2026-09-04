/**
 * Copy staging JWT_SECRET into local .env without printing the value.
 * Tries GCP Secret Manager first, then Railway GraphQL if RAILWAY_TOKEN is set.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'epickup-app';
const ENV_PATH = path.resolve(__dirname, '..', '.env');
const KEY_FILE = path.resolve(__dirname, '..', 'firebase-service-account.json');
const CANDIDATE_NAMES = [
  'JWT_SECRET',
  'JWT_SECRET_STAGING',
  'STAGING_JWT_SECRET',
  'EPICKUP_JWT_SECRET'
];

function upsertEnvKey(filePath, key, value) {
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=`, 'm').test(raw)) {
    const next = raw.replace(new RegExp(`^${key}=.*$`, 'm'), line);
    fs.writeFileSync(filePath, next.endsWith('\n') ? next : `${next}\n`);
    return 'updated';
  }
  const prefix = raw.length && !raw.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(filePath, `${raw}${prefix}${line}\n`);
  return 'added';
}

async function fromSecretManager(client) {
  const listUrl = `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets`;
  let listed;
  try {
    listed = await client.request({ url: listUrl });
  } catch (error) {
    const status = error.response && error.response.status;
    console.log(`Secret Manager list failed: ${status || error.message}`);
    return null;
  }
  const secrets = listed.data.secrets || [];
  const names = secrets.map((s) => (s.name || '').split('/').pop());
  console.log(`Secret Manager secrets: ${names.length ? names.join(', ') : '(none)'}`);
  const hit = CANDIDATE_NAMES.find((n) => names.includes(n));
  if (!hit) {
    return null;
  }
  const acc = await client.request({
    url: `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${hit}/versions/latest:access`
  });
  const b64 = acc.data.payload && acc.data.payload.data;
  if (!b64) {
    return null;
  }
  return { name: hit, value: Buffer.from(b64, 'base64').toString('utf8').trim() };
}

async function main() {
  const auth = new GoogleAuth({
    keyFilename: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  const sm = await fromSecretManager(client);
  if (!sm || !sm.value) {
    console.log('No JWT signing secret found in GCP Secret Manager.');
    process.exit(2);
  }
  const action = upsertEnvKey(ENV_PATH, 'JWT_SECRET', sm.value);
  console.log(`Local .env JWT_SECRET ${action} from Secret Manager secret ${sm.name} (length ${sm.value.length})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
