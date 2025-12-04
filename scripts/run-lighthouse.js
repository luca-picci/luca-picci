const fs = require('fs');
const path = require('path');
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');

const sitesEnv = process.env.LIGHTHOUSE_SITES;

if (!sitesEnv) {
  console.error('Nessun sito configurato in LIGHTHOUSE_SITES');
  process.exit(1);
}

const sites = sitesEnv
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

if (sites.length === 0) {
  console.error('LIGHTHOUSE_SITES è vuoto o commentato');
  process.exit(1);
}

const outputDir = path.join(process.cwd(), 'lighthouse');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

function createBadgeSVG(label, score) {
  const rounded = Math.round(score);
  const text = `${label}: ${rounded}`;
  const labelColor = '#555';

  let valueColor = '#e05d44'; 
  if (rounded >= 90) valueColor = '#4c1';      
  else if (rounded >= 50) valueColor = '#dfb317'; 

  const labelWidth = 60;
  const valueWidth = 60;
  const totalWidth = labelWidth + valueWidth;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${text}">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-opacity=".7" stop-color="#fff"/>
    <stop offset=".1" stop-opacity=".1" stop-color="#aaa"/>
    <stop offset=".9" stop-opacity=".3"/>
    <stop offset="1" stop-opacity=".5"/>
  </linearGradient>
  <mask id="round">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#round)">
    <rect width="${labelWidth}" height="20" fill="${labelColor}"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${valueColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle"
     font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${rounded}</text>
  </g>
</svg>
`.trim();
}

async function runLighthouseOnUrl(url) {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
  const options = { logLevel: 'error', output: 'json', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], port: chrome.port };

  try {
    const runnerResult = await lighthouse(url, options);
    const categories = runnerResult.lhr.categories;
    return {
      performance: categories.performance.score * 100,
      accessibility: categories.accessibility.score * 100,
      bestPractices: categories['best-practices'].score * 100,
      seo: categories.seo.score * 100,
    };
  } finally {
    await chrome.kill();
  }
}

(async () => {
  const totals = {
    performance: 0,
    accessibility: 0,
    bestPractices: 0,
    seo: 0,
  };
  let count = 0;

  for (const url of sites) {
    console.log(`Eseguo Lighthouse su: ${url}`);
    try {
      const scores = await runLighthouseOnUrl(url);
      totals.performance += scores.performance;
      totals.accessibility += scores.accessibility;
      totals.bestPractices += scores.bestPractices;
      totals.seo += scores.seo;
      count += 1;
    } catch (err) {
      console.error(`Errore con ${url}:`, err.message);
    }
  }

  if (count === 0) {
    console.error('Nessun risultato valido da Lighthouse');
    process.exit(1);
  }

  const averages = {
    performance: totals.performance / count,
    accessibility: totals.accessibility / count,
    bestPractices: totals.bestPractices / count,
    seo: totals.seo / count,
  };

  const badges = [
    { filename: 'performance.svg', label: 'Performance', score: averages.performance },
    { filename: 'accessibility.svg', label: 'Accessibility', score: averages.accessibility },
    { filename: 'best-practices.svg', label: 'Best Practices', score: averages.bestPractices },
    { filename: 'seo.svg', label: 'SEO', score: averages.seo },
  ];

  for (const badge of badges) {
    const svg = createBadgeSVG(badge.label, badge.score);
    const filePath = path.join(outputDir, badge.filename);
    fs.writeFileSync(filePath, svg, 'utf8');
    console.log(`Creato badge: ${filePath}`);
  }

  console.log('Lighthouse completato, badge aggiornati.');
})();
