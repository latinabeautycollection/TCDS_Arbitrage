import { readFileSync } from 'node:fs';

const forbidden = [
  'packages.applied-caas-gateway1.internal.api.openai.org',
  'internal.api.openai.org',
];

const files = ['package-lock.json', '.npmrc'];
const violations = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const token of forbidden) {
    if (text.includes(token)) violations.push(`${file}: ${token}`);
  }
}
if (violations.length) {
  console.error('Private registry references detected:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('Registry verification passed: public npm registry only.');
