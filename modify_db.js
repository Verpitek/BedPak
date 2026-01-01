import { readFileSync, writeFileSync } from 'fs';
const content = readFileSync('src/db_controller.ts', 'utf8');
// Find the line index where runMigrations is called
const lines = content.split('\n');
let insertIndex = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('await this.runMigrations();')) {
    insertIndex = i;
    break;
  }
}
if (insertIndex === -1) {
  console.error('Could not find runMigrations line');
  process.exit(1);
}
// Insert table creation before that line
const newLines = [
  ...lines.slice(0, insertIndex),
  '      // Create download_history table',
  '      await this.sqlite`',
  '        CREATE TABLE IF NOT EXISTS download_history (',
  '          id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '          package_id INTEGER NOT NULL,',
  '          date TEXT NOT NULL,',
  '          download_count INTEGER DEFAULT 0,',
  '          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,',
  '          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,',
  '          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,',
  '          UNIQUE(package_id, date)',
  '        )`;',
  '',
  '      // Create index for faster queries',
  '      await this.sqlite`',
  '        CREATE INDEX IF NOT EXISTS idx_download_history_package_date ON download_history(package_id, date)`;',
  '',
  ...lines.slice(insertIndex)
];
// Now modify incrementDownloads method
let inIncrement = false;
let incrementStart = -1;
let incrementEnd = -1;
for (let i = 0; i < newLines.length; i++) {
  if (newLines[i].includes('public async incrementDownloads(packageId: number)')) {
    incrementStart = i;
    inIncrement = true;
  }
  if (inIncrement && newLines[i].trim() === '}') {
    incrementEnd = i;
    break;
  }
}
if (incrementStart === -1 || incrementEnd === -1) {
  console.error('Could not find incrementDownloads method');
  process.exit(1);
}
const replacementMethod = `   public async incrementDownloads(packageId: number) {
     const today = new Date().toISOString().split('T')[0];
     // Update download_history with UPSERT
     await this.sqlite\`
       INSERT INTO download_history (package_id, date, download_count) 
       VALUES (\${packageId}, \${today}, 1)
       ON CONFLICT(package_id, date) DO UPDATE SET 
         download_count = download_count + 1,
         updated_at = CURRENT_TIMESTAMP
     \`;
     // Increment total downloads in packages table
     return await this.sqlite\`UPDATE packages SET downloads = downloads + 1 WHERE id = \${packageId} RETURNING *\`;
   }`;
const updatedLines = [
  ...newLines.slice(0, incrementStart),
  replacementMethod,
  ...newLines.slice(incrementEnd + 1)
];
// Now add new methods before the final closing brace of the class
let classEndIndex = -1;
for (let i = updatedLines.length - 1; i >= 0; i--) {
  if (updatedLines[i].trim() === '}') {
    classEndIndex = i;
    break;
  }
}
if (classEndIndex === -1) {
  console.error('Could not find class end');
  process.exit(1);
}
const newMethods = `
   // ==================== DOWNLOAD HISTORY METHODS ====================

   public async getDailyDownloads(packageId: number, days: number = 30): Promise<Array<{date: string, count: number}>> {
     try {
       const today = new Date().toISOString().split('T')[0];
       const startDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
       
       // Generate date series using recursive CTE
       const results = await this.sqlite\`
         WITH RECURSIVE dates(date) AS (
           SELECT \${startDate}
           UNION ALL
           SELECT date(date, '+1 day')
           FROM dates
           WHERE date < \${today}
         )
         SELECT 
           dates.date as date,
           COALESCE(dh.download_count, 0) as count
         FROM dates
         LEFT JOIN download_history dh ON dates.date = dh.date AND dh.package_id = \${packageId}
         ORDER BY dates.date DESC
       \`;
       
       return results.map((row: Record<string, unknown>) => ({
         date: row.date as string,
         count: row.count as number
       }));
     } catch (err) {
       console.error("Error fetching daily downloads:", err);
       return [];
     }
   }

   public async getMonthlyDownloads(packageId: number, months: number = 12): Promise<Array<{month: string, count: number}>> {
     try {
       // Calculate start date (first day of month X months ago)
       const now = new Date();
       const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
       const startYearMonth = startDate.getFullYear() + '-' + String(startDate.getMonth() + 1).padStart(2, '0');
       
       const results = await this.sqlite\`
         SELECT 
           strftime('%Y-%m', date) as month,
           SUM(download_count) as total_downloads
         FROM download_history
         WHERE package_id = \${packageId}
           AND date >= \${startYearMonth + '-01'}
         GROUP BY strftime('%Y-%m', date)
         ORDER BY month DESC
         LIMIT \${months}
       \`;
       
       return results.map((row: Record<string, unknown>) => ({
         month: row.month as string,
         count: row.total_downloads as number
       }));
     } catch (err) {
       console.error("Error fetching monthly downloads:", err);
       return [];
     }
   }

   public async getTotalDownloadsByDateRange(startDate: string, endDate: string): Promise<number> {
     try {
       const result = await this.sqlite\`
         SELECT COALESCE(SUM(download_count), 0) as total
         FROM download_history
         WHERE date >= \${startDate} AND date <= \${endDate}
       \`;
       return result[0]?.total ?? 0;
     } catch (err) {
       console.error("Error fetching total downloads by date range:", err);
       return 0;
     }
   }
`;
const finalLines = [
  ...updatedLines.slice(0, classEndIndex),
  newMethods,
  ...updatedLines.slice(classEndIndex)
];
writeFileSync('src/db_controller.ts', finalLines.join('\n'));
console.log('File updated successfully');
