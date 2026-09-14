// Download and extract https://download.geonames.org/export/dump/cities5000.zip,
// then run: node scripts/import-radar-cities.cjs path/to/cities5000.txt
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
if (!input) throw new Error('Informe o caminho de cities5000.txt');
const cities = fs.readFileSync(input, 'utf8').trim().split(/\r?\n/).map(line => line.split('\t'))
  .filter(row => row[6] === 'P' && /^(PPL|PPLA[1-5]?|PPLC|PPLG)$/.test(row[7]))
  .map(row => [row[1], +Number(row[5]).toFixed(4), +Number(row[4]).toFixed(4), Number(row[14]) || 0])
  .filter(([, lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
const data = {
  source: 'GeoNames cities5000 — https://download.geonames.org/export/dump/',
  license: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
  generatedAt: new Date().toISOString().slice(0, 10),
  fields: ['name', 'longitude', 'latitude', 'population'],
  cities
};
fs.writeFileSync(path.join(__dirname, '../src/ui/radar-cities.json'), JSON.stringify(data) + '\n');
console.log(`${cities.length} cidades importadas.`);
