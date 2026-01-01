import { readFileSync, writeFileSync } from 'fs';
const content = readFileSync('src/db_controller.ts', 'utf8');
const lines = content.split('\n');
let newLines = [];
for (let i = 0; i < lines.length; i++) {
  newLines.push(lines[i]);
  if (lines[i].includes('idx_download_history_package_date')) {
    // Add extra index on date column
    newLines.push('      await this.sqlite`');
    newLines.push('        CREATE INDEX IF NOT EXISTS idx_download_history_date ON download_history(date)`;');
  }
}
writeFileSync('src/db_controller.ts', newLines.join('\n'));
console.log('Added date index');
