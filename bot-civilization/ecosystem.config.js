module.exports = {
  apps: [
    {
      name: 'SiPetani',
      script: './bot.js',
      env: {
        BOT_USERNAME: 'SiPetani',
        PRIMARY_SKILL: 'farming',
      },
    },
    {
      name: 'SiPenebang',
      script: './bot.js',
      env: {
        BOT_USERNAME: 'SiPenebang',
        PRIMARY_SKILL: 'logging',
      },
    },
    {
      name: 'SiPenambang',
      script: './bot.js',
      env: {
        BOT_USERNAME: 'SiPenambang',
        PRIMARY_SKILL: 'mining',
      },
    },
    {
      name: 'SiPenjaga',
      script: './bot.js',
      env: {
        BOT_USERNAME: 'SiPenjaga',
        PRIMARY_SKILL: 'combat',
      },
    },
    {
      name: 'SiBuilder',
      script: './bot.js',
      env: {
        BOT_USERNAME: 'SiBuilder',
        PRIMARY_SKILL: 'building',
      },
    },
  ].map(app => ({
    ...app,
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 30000,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    out_file: `./logs/${app.name}-out.log`,
    error_file: `./logs/${app.name}-err.log`,
  })),
};
