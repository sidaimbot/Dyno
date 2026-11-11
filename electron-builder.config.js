const pkg = require('./package.json');

function readFeed() {
  try { return require('./update-feed.json'); }
  catch (_) { return {}; }
}

// Owner/repo come from the environment in CI, or from update-feed.json locally.
// Nothing here is a credential.
const source = readFeed();
const owner = String(process.env.UPDATE_GITHUB_OWNER || source.owner || '').trim();
const repo = String(process.env.UPDATE_GITHUB_REPO || source.repo || '').trim();

// package.json always carries the build block; read it defensively so a stripped
// or partial manifest can never silently fall back to electron-builder's defaults.
const base = pkg.build || {};
if (!base.appId || !base.productName) {
  throw new Error('package.json is missing build.appId / build.productName — refusing to build with default packaging.');
}

const config = {
  ...base,
  files: [...new Set([...(base.files || []), 'update-feed.json'])]
};

if (owner && repo) {
  config.publish = [{
    provider: 'github',
    owner,
    repo,
    private: source.private === true,
    releaseType: 'release'
  }];
}

module.exports = config;
