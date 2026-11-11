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

const config = {
  ...pkg.build,
  files: [...new Set([...(pkg.build.files || []), 'update-feed.json'])]
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
