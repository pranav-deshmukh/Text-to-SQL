import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const envConfig = `
export const environment = {
  production: ${process.env['PROD_ENV'] === 'true'},
  apiUrl: '${process.env['API_URL']}',
  enableLogsUi: ${process.env['LOGS_UI'] === 'true'},
};
`;

fs.writeFileSync(
  './src/environments/environment.ts',
  envConfig
);