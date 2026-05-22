import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const apiUrl = process.env['API_URL']?.trim() || 'http://localhost:3001';
const enableLogsUi = process.env['LOGS_UI'] === 'true';
const production = process.env['PROD_ENV'] === 'true';

const envConfig = `
export const environment = {
  production: ${production},
  apiUrl: '${apiUrl}',
  enableLogsUi: ${enableLogsUi},
};
`;

fs.writeFileSync(
  './src/environments/environment.ts',
  envConfig
);