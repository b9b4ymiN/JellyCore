import fs from 'fs';
import type { Hono } from 'hono';

interface LegacyUiPaths {
  arthurPath: string;
  oracleUiPath: string;
  dashboardPath: string;
}

export function registerLegacyUiRoutes(
  app: Hono,
  paths: LegacyUiPaths,
): void {
  app.get('/legacy/arthur', (c) => {
    const content = fs.readFileSync(paths.arthurPath, 'utf-8');
    return c.html(content);
  });

  app.get('/legacy/oracle', (c) => {
    const content = fs.readFileSync(paths.oracleUiPath, 'utf-8');
    return c.html(content);
  });

  app.get('/legacy/dashboard', (c) => {
    const content = fs.readFileSync(paths.dashboardPath, 'utf-8');
    return c.html(content);
  });
}
