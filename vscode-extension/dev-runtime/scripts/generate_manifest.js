#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function listFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

function toPosixPath(input) {
  return input.split(path.sep).join('/');
}

async function buildArtifactMap(artifactsDir, baseUrl) {
  const entries = await fs.readdir(artifactsDir, { withFileTypes: true });
  const artifacts = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const target = entry.name;
    const targetDir = path.join(artifactsDir, target);
    const files = await listFiles(targetDir);
    if (files.length === 0) {
      continue;
    }
    if (files.length > 1) {
      throw new Error(`Expected exactly one file in ${targetDir}, found ${files.length}`);
    }

    const fileName = files[0];
    const filePath = path.join(targetDir, fileName);
    const sha256 = await sha256File(filePath);
    artifacts[target] = {
      url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(target)}/${encodeURIComponent(fileName)}`,
      sha256,
      fileName
    };
  }

  return artifacts;
}

async function main() {
  const args = parseArgs(process.argv);
  const version = String(args.version || '').trim();
  const baseUrl = String(args['base-url'] || '').trim();
  const artifactsDir = path.resolve(args['artifacts-dir'] || path.join(process.cwd(), 'dist', 'releases'));
  const outputPath = path.resolve(args.output || path.join(artifactsDir, 'manifest.json'));
  const channel = String(args.channel || 'stable').trim();

  if (!version) {
    throw new Error('Missing required --version');
  }
  if (!baseUrl) {
    throw new Error('Missing required --base-url');
  }
  if (!(await pathExists(artifactsDir))) {
    throw new Error(`Artifacts directory not found: ${artifactsDir}`);
  }

  const artifacts = await buildArtifactMap(artifactsDir, baseUrl);
  if (Object.keys(artifacts).length === 0) {
    throw new Error(`No artifacts discovered under ${artifactsDir}`);
  }

  const manifest = {
    version,
    channel,
    generatedAt: new Date().toISOString(),
    artifacts
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  process.stdout.write(`${toPosixPath(outputPath)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
