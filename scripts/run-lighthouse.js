const fs = require('fs');
const path = require('path');
const chromeLauncher = require('chrome-launcher');
const lighthouse = require('lighthouse/core/index.cjs');

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
  fs.mkdirSync(outputDir, { recursive: true });
}

function scoreColor(score) {
  if (score >= 90) return '#0cce6b';    
  if (score >= 50) return '#ffa400';    
  return '#ff4e42';                     
}

function createGaugeSVG(label, score) {
  const rounded = Math.round(score);
  const color = scoreColor(rounded);

  const size = 120;
  const center = size / 2;
  const radius = 45;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const progress = (rounded / 100) * circumference;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label} score ${rounded}">
  <defs>
    <style>
      .label { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 11px; fill: #555; }
      .score { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 26px; font-weight: 600; fill: #202124; }
    </style>
  </defs>

  <!-- Sfondo -->
  <circle
    cx="${center}"
    cy="${center}"
    r="${radius}"
    fill="none"
    stroke="#e6e6e6"
    stroke-width="${strokeWidth}"
  />

  <!-- Anello di progresso -->
  <circle
    cx="${center}"
    cy="${center}"
    r="${radius}"
    fill="none"
    stroke="${color}"
    stroke-width="${strokeWidth}"
    stroke-linecap="round"
    stroke-dasharray="${progress} ${circumference - progress}"
    transform="rotate(-90 ${center} ${center})"
  />

  <!-- Testo punteggio -->
  <text
    x="${center}"
    y="${center + 8}"
    text-anchor="middle"
    class="score"
  >
    ${rounded}
  </text>

  <!-- Label sotto -->
  <text
    x="${center}"
    y="${size - 10}"
    text-anchor="middle"
    class="label"
  >
    ${label}
  </text>
</svg>
`.trim();
}

async function runLighthouseOnUrl(url) {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
  });

  const options = {
    logLevel: 'error',
    output: 'json',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    port: chrome.port,
  };

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
      console.log('Punteggi:', scores);
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

  console.log('Medie:', averages);

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
    console.log(`Creato gauge: ${filePath}`);
  }

  console.log('Lighthouse completato, gauge aggiornati.');
})();
