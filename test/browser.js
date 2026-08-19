// Where to find a browser. Hardcoding the macOS Chrome path meant these suites could
// only ever run on one laptop; CHROME_PATH lets CI and anyone else point at theirs.
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
].filter(Boolean);

const { existsSync } = require('node:fs');

exports.launchOptions = () => {
  const executablePath = CANDIDATES.find(path => existsSync(path));
  if (!executablePath) {
    console.error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
    process.exit(2);
  }
  // --no-sandbox is for containers; harmless on a desktop.
  return { executablePath, args: process.env.CI ? ['--no-sandbox'] : [] };
};

// Select-all is Cmd+A on macOS and Ctrl+A everywhere else. Hardcoding Meta+A meant
// every "type over an existing value" check silently appended on Linux instead of
// replacing — and still reported PASS on a laptop.
exports.SELECT_ALL = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
