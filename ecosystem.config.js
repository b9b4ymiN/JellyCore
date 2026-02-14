/**
 * PM2 Ecosystem Configuration for JellyCore
 *
 * Manages NanoClaw (host) and Oracle V2 (independent service)
 * with auto-restart, memory limits, log rotation, and graceful shutdown.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    // NanoClaw - WhatsApp/Telegram Router, Container Manager, Queue, Scheduler
    {
      name: 'nanoclaw',
      script: 'dist/index.js', // compiled JS from TypeScript
      cwd: './nanoclaw',
      interpreter: 'node',
      instances: 1, // single instance (stateful: WhatsApp session, queue)
      max_memory_restart: '1G',
      max_restarts: 10,
      min_uptime: '10s', // must run >10s to consider stable
      restart_delay: 5000, // wait 5s before restart
      exp_backoff_restart_delay: 100, // exponential backoff
      kill_timeout: 15000, // 15s for graceful shutdown
      listen_timeout: 10000,
      watch: false, // disable file watching (production)
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/jellycore/nanoclaw-error.log',
      out_file: '/var/log/jellycore/nanoclaw-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Graceful shutdown: PM2 sends SIGINT → NanoClaw drains queue
      autorestart: true,
      // PM2 will restart if crashes more than 10 times in 1min (default)
    },
    // Oracle V2 - Knowledge Engine (HTTP API)
    {
      name: 'oracle-v2',
      script: 'src/server.ts',
      cwd: './oracle-v2',
      interpreter: 'bun',
      instances: 1, // single instance (stateful: SQLite + ChromaDB connection)
      max_memory_restart: '512M',
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 3000, // wait 3s before restart
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000, // 10s for graceful shutdown
      listen_timeout: 5000,
      watch: false,
      env: {
        NODE_ENV: 'production',
        ORACLE_PORT: '47778',
        ORACLE_REPO_ROOT: '/data/knowledge',
        ORACLE_DATA_DIR: '/data/oracle',
      },
      error_file: '/var/log/jellycore/oracle-error.log',
      out_file: '/var/log/jellycore/oracle-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      autorestart: true,
    },
  ],
};
