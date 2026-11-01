/**
 * Resolve the next version to publish and write it into package.json.
 *
 * Fully automatic: you never edit the version by hand:
 *   1. Never published yet            → publish package.json's version as-is.
 *   2. package.json bumped manually    → if it's higher than everything on npm and
 *      to a higher version             not yet published, respect it (manual override).
 *   3. Otherwise (the common case)     → auto-bump from the highest version on npm, with
 *                                        the bump TYPE derived from the Conventional
 *                                        Commits since the last release: `feat` → minor,
 *                                        `!`/`BREAKING CHANGE` → major, anything else →
 *                                        patch (skipping any version that's already taken).
 *
 * Emits `version`, `bumped`, `bump` and `previous` to GITHUB_OUTPUT for the workflow.
 * Run with: node scripts/release-version.mjs
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import semver from 'semver';

const pkgUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
const name = pkg.name;
const local = pkg.version;

if (!semver.valid(local)) {
  console.error(`package.json version "${local}" is not valid semver.`);
  process.exit(1);
}

// All versions already on npm (empty if the package was never published).
let published = [];
try {
  const raw = execSync(`npm view ${name} versions --json`, {
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
  const parsed = JSON.parse(raw);
  published = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  published = [];
}

const highest = published.length
  ? published.slice().sort(semver.rcompare)[0]
  : null;

// Determine the semver bump (major/minor/patch) from Conventional Commits made since
// the last release ref. Mirrors the other CosmosPay repos: `feat` -> minor,
// `!` or `BREAKING CHANGE` -> major, anything else -> patch.
function bumpFromCommits(sinceRef) {
  let log = '';
  try {
    const range = sinceRef ? `${sinceRef}..HEAD` : 'HEAD';
    log = execSync(`git log ${range} --format=%B`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return 'patch'; // can't read history -> release a patch rather than silently skip
  }
  if (/(^|\n)[ \t]*BREAKING CHANGE/.test(log) || /(^|\n)[a-z]+(\([^)]+\))?!:/.test(log)) return 'major';
  if (/(^|\n)feat(\([^)]+\))?:/i.test(log)) return 'minor';
  if (/(^|\n)(fix|perf|refactor|revert)(\([^)]+\))?:/i.test(log)) return 'patch';
  return 'none'; // only chore/docs/ci/style/test/build (or no new commits) -> nothing to release
}

// The tag marking the last released commit: the boundary for "commits since release".
// Best-effort: needs tags present (the release workflow checks out with fetch-tags).
function lastReleaseRef(highestVersion) {
  if (!highestVersion) return null;
  for (const tag of [`v${highestVersion}`, highestVersion]) {
    try {
      execSync(`git rev-parse -q --verify refs/tags/${tag}`, { stdio: 'ignore' });
      return tag;
    } catch {
      /* tag not present: try the next form */
    }
  }
  return null;
}

let target;
let bumped = false;
let bump = 'none';
let release = true; // whether this push warrants publishing a new version at all

if (!highest) {
  // 1. First publish ever.
  target = local;
} else if (!published.includes(local) && semver.gt(local, highest)) {
  // 2. Manual override: package.json was bumped higher than anything on npm.
  target = local;
} else {
  // 3. Auto-bump from the highest published version, with the type from Conventional Commits.
  bump = bumpFromCommits(lastReleaseRef(highest));
  if (bump === 'none') {
    // Nothing release-worthy since the last release -> skip (no publish, no tag, no commit).
    target = highest;
    release = false;
  } else {
    target = semver.inc(highest, bump);
    while (published.includes(target)) target = semver.inc(target, 'patch');
    bumped = true;
  }
}

// Only touch the version files when we're actually releasing.
if (release) {
  if (target !== local) {
    pkg.version = target;
    writeFileSync(pkgUrl, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  // The server's version is read from package.json at build time (tsup.config.ts `define`),
  // so package.json is the only file to bump.
} else {
  console.log('No release-worthy commits since the last release: skipping.');
}

const out = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
};

out('version', target);
out('bumped', bumped ? 'true' : 'false');
out('bump', bump);
out('release', release ? 'true' : 'false');
out('previous', highest ?? '(none)');
