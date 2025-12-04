const fs = require('fs');
const path = require('path');
const chromeLauncher = require('chrome-launcher');
const lighthouse = require('lighthouse/core/index.cjs');

const SITES_ENV = process.env.LIGHTHOUSE_SITES || '';

function parseSites(raw) {
  return raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function clampScore(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function scoreColor(score) {
  if (score >= 90) return '#0cce6b';
  if (score >= 50) return '#ffa400';
  return '#ff4e42';
}

function createGaugeSVG(label, score) {
  const rounded = Math.round(clampScore(score));
  const color = scoreColor(rounded);

  const size = 160;
  const padding = 14;
  const labelArea = 22;
  const innerGap = 6;

  const usableHeight = size - padding * 2 - labelArea - innerGap;
  const centerX = size / 2;
  const centerY = padding + usableHeight / 2;

  const radius = 50;
  const strokeWidth = 11;
  const circumference = 2 * Math.PI * radius;
  const progress = (rounded / 100) * circumference;

  const idBase = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const shadowId = `${idBase}-shadow`;
  const arcGradientId = `${idBase}-arc-gradient`;
  const bgGradientId = `${idBase}-bg-gradient`;

  return `
<svg xmlns="http://www.w3.org/2000/svg"
     width="${size}" height="${size}"
     viewBox="0 0 ${size} ${size}"
     role="img"
     aria-labelledby="${idBase}-title ${idBase}-desc">
  <title id="${idBase}-title">${label}</title>
  <desc id="${idBase}-desc">${label} score ${rounded} of 100</desc>

  <defs>
    <filter id="${shadowId}" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#00000040"/>
    </filter>

    <radialGradient id="${bgGradientId}" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#f3f4f6" />
    </radialGradient>

    <linearGradient id="${arcGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.8" />
      <stop offset="100%" stop-color="${color}" stop-opacity="1" />
    </linearGradient>

    <style>
      .lh-label {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        font-weight: 500;
        fill: #5f6368;
      }
      .lh-score {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 30px;
        font-weight: 600;
        fill: #111827;
      }
    </style>
  </defs>

  <rect
    x="${padding - 2}"
    y="${padding - 2}"
    width="${size - (padding - 2) * 2}"
    height="${size - (padding - 2) * 2}"
    rx="18"
    fill="#ffffff"
    stroke="#e5e7eb"
    filter="url(#${shadowId})"
  />

  <circle
    cx="${centerX}"
    cy="${centerY}"
    r="${radius}"
    fill="url(#${bgGradientId})"
    stroke="#e5e7eb"
    stroke-width="${strokeWidth}"
  />
  <circle
    cx="${centerX}"
    cy="${centerY}"
    r="${radius - strokeWidth + 2}"
    fill="#ffffff"
  />

  <circle
    cx="${centerX}"
    cy="${centerY}"
    r="${radius}"
    fill="none"
    stroke="url(#${arcGradientId})"
    stroke-width="${strokeWidth}"
    stroke-linecap="round"
    stroke-dasharray="${progress} ${circumference - progress}"
    transform="rotate(-90 ${centerX} ${centerY})"
  />

  <text
    x="${centerX}"
    y="${centerY + 6}"
    text-anchor="middle"
    class="lh-score"
  >
    ${rounded}
  </text>

  <text
    x="${centerX}"
    y="${size - padding}"
    text-anchor="middle"
    class="lh-label"
  >
    ${label}
  </text>
</svg>
`.trim();
}

async function runLighthouseForUrl(chrome, url) {
  const options = {
    logLevel: 'error',
    output: 'json',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    port: chrome.port,
  };

  const runnerResult = await lighthouse(url, options);
  const c = runnerResult.lhr.categories;

  const get = k => clampScore((c[k]?.score || 0) * 100);

  return {
    performance: get('performance'),
    accessibility: get('accessibility'),
    bestPractices: get('best-practices'),
    seo: get('seo'),
  };
}

async function main() {
  const sites = parseSites(SITES_ENV);
  if (!sites.length) {
    console.error('LIGHTHOUSE_SITES is empty');
    process.exit(1);
  }

  const outputDir = path.join(process.cwd(), 'lighthouse');
  ensureDir(outputDir);

  const totals = { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 };
  let count = 0;

  console.log(`Running Lighthouse on ${sites.length} sites...\n`);

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
  });

  try {
    for (const url of sites) {
      console.log(`→ ${url}`);
      try {
        const scores = await runLighthouseForUrl(chrome, url);
        console.log('   Scores:', scores);
        totals.performance += scores.performance;
        totals.accessibility += scores.accessibility;
        totals.bestPractices += scores.bestPractices;
        totals.seo += scores.seo;
        count++;
      } catch (e) {
        console.error(`   Error: ${e.message}`);
      }
    }
  } finally {
    await chrome.kill();
  }

  if (!count) {
    console.error('No valid Lighthouse results');
    process.exit(1);
  }

  const averages = {
    performance: totals.performance / count,
    accessibility: totals.accessibility / count,
    bestPractices: totals.bestPractices / count,
    seo: totals.seo / count,
  };

  console.log('\nAverages:', averages);

  const gauges = [
    { filename: 'performance.svg', label: 'Performance', score: averages.performance },
    { filename: 'accessibility.svg', label: 'Accessibility', score: averages.accessibility },
    { filename: 'best-practices.svg', label: 'Best Practices', score: averages.bestPractices },
    { filename: 'seo.svg', label: 'SEO', score: averages.seo },
  ];

  for (const g of gauges) {
    const svg = createGaugeSVG(g.label, g.score);
    const filePath = path.join(outputDir, g.filename);
    fs.writeFileSync(filePath, svg, 'utf8');
    console.log(`Created: ${filePath}`);
  }

  const summaryPath = path.join(outputDir, 'summary.json');
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), sites, averages },
      null,
      2
    )
  );

  console.log('\nLighthouse finished. Gauges updated.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
