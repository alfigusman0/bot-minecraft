module.exports = {
  apps: [
    { name: 'SiPetani', script: './bots/universal-bot.js', env: { BOT_USERNAME: 'SiPetani' } },
    { name: 'SiPenebang', script: './bots/universal-bot.js', env: { BOT_USERNAME: 'SiPenebang' } },
    {
      name: 'SiPenambang',
      script: './bots/universal-bot.js',
      env: { BOT_USERNAME: 'SiPenambang' },
    },
    { name: 'SiPenjaga', script: './bots/universal-bot.js', env: { BOT_USERNAME: 'SiPenjaga' } },
    { name: 'SiBuilder', script: './bots/universal-bot.js', env: { BOT_USERNAME: 'SiBuilder' } },
  ].map(app => ({
    ...app,
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 10000,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    out_file: `./logs/${app.name}-out.log`,
    error_file: `./logs/${app.name}-err.log`,
  })),
};
