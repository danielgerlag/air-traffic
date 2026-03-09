import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateManifest } from './manifest-template.js';

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runInit(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🛫  Air Traffic Setup\n');

  const machineName = (await prompt(rl, 'Machine name (e.g. desktop, laptop): ')).trim();
  if (!machineName) {
    console.log('❌ Machine name is required.');
    rl.close();
    process.exit(1);
  }

  const manifest = generateManifest(machineName);

  console.log('\n────────────────────────────────────────');
  console.log('📋 Generated Slack App Manifest:\n');
  console.log(manifest);
  console.log('────────────────────────────────────────');

  console.log('\nNext steps:');
  console.log('  1. Go to https://api.slack.com/apps');
  console.log('  2. Click "Create New App" → "From a manifest"');
  console.log('  3. Select your workspace and paste the YAML above');
  console.log('  4. Click "Create" then "Install to Workspace"');
  console.log('  5. Copy the tokens below:\n');

  const botToken = (await prompt(rl, 'SLACK_BOT_TOKEN (OAuth & Permissions → Bot User OAuth Token): ')).trim();
  const signingSecret = (await prompt(rl, 'SLACK_SIGNING_SECRET (Basic Information → App Credentials): ')).trim();

  console.log('\n  Now create an App-Level Token:');
  console.log('  Basic Information → App-Level Tokens → Generate Token');
  console.log('  Name: "socket" — Scope: connections:write\n');

  const appToken = (await prompt(rl, 'SLACK_APP_TOKEN (xapp-...): ')).trim();

  if (!botToken || !signingSecret || !appToken) {
    console.log('\n❌ All tokens are required.');
    rl.close();
    process.exit(1);
  }

  // Optional config
  const projectsDir = (await prompt(rl, `Projects directory [${path.join(process.env.HOME ?? '~', 'projects')}]: `)).trim()
    || path.join(process.env.HOME ?? '~', 'projects');
  const defaultModel = (await prompt(rl, 'Default model [claude-sonnet-4.5]: ')).trim() || 'claude-sonnet-4.5';

  rl.close();

  const envContent = [
    `# Air Traffic — ${machineName}`,
    `ATC_MACHINE_NAME=${machineName}`,
    `SLACK_BOT_TOKEN=${botToken}`,
    `SLACK_APP_TOKEN=${appToken}`,
    `SLACK_SIGNING_SECRET=${signingSecret}`,
    `ATC_PROJECTS_DIR=${projectsDir}`,
    `ATC_DEFAULT_MODEL=${defaultModel}`,
    '',
  ].join('\n');

  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    console.log(`\n⚠️  ${envPath} already exists.`);
    const envNewPath = path.resolve(`.env.${machineName}`);
    fs.writeFileSync(envNewPath, envContent, 'utf-8');
    console.log(`✅ Wrote ${envNewPath}`);
  } else {
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log(`\n✅ Wrote ${envPath}`);
  }

  // Save manifest for reference
  const manifestPath = path.resolve(`slack-manifest-${machineName}.yaml`);
  fs.writeFileSync(manifestPath, manifest, 'utf-8');
  console.log(`✅ Wrote ${manifestPath}`);

  console.log(`\n🚀 Start with: npx air-traffic\n`);
}
