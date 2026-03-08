import { logger } from './logger.js';
import { _setRegisteredGroups, getAvailableGroups, main } from './orchestrator.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';
export { _setRegisteredGroups, getAvailableGroups, main };

const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
