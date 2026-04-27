import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

const body = readFileSync('./raw_kml_sample.xml', 'utf8');
const p = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', cdataPropName: '__cdata',
  isArray: n => n === 'Placemark' || n === 'Folder'
});
const parsed = p.parse(body);
const folder = parsed.kml.Document.Folder;
const f0 = Array.isArray(folder) ? folder[0] : folder;
console.log('Folder has', f0.Placemark?.length, 'placemarks');
const pm0 = f0.Placemark[0];
console.log('PM keys:', Object.keys(pm0));
console.log('PM id:', pm0['@_id']);
console.log('Has Polygon:', !!pm0.Polygon);
console.log('Has LineString:', !!pm0.LineString);
console.log('Has MultiGeometry:', !!pm0.MultiGeometry);
if (pm0.MultiGeometry) {
  console.log('MultiGeometry keys:', Object.keys(pm0.MultiGeometry));
  const mg = pm0.MultiGeometry;
  console.log('MG Polygon:', !!mg.Polygon, 'MG LineString:', !!mg.LineString);
  if (mg.LineString) {
    const coords = String(mg.LineString.coordinates || '').substring(0, 150);
    console.log('LineString coords (first 150):', coords);
  }
}
console.log('\nFull PM0 JSON:', JSON.stringify(pm0).substring(0, 800));
