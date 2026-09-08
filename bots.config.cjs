const path = require("path");

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, "logs");

module.exports = {
  apps: [
    {
      name: "maker1-bot",
      script: "./trading_bot.sh",
      interpreter: "/bin/bash",
      kill_timeout: 30000,
      out_file: path.join(LOG_DIR, "maker1-bot.log"),
      error_file: path.join(LOG_DIR, "maker1-bot-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
      env: {
        BOT_ENV_FILE: ".env.maker1",
        BOT_NAME: "maker1-bot",
        CONTROL_SOCKET_DIR: "/tmp",
      },
    },
    {
      name: "taker1-bot",
      script: "./trading_bot.sh",
      interpreter: "/bin/bash",
      kill_timeout: 30000,
      out_file: path.join(LOG_DIR, "taker1-bot.log"),
      error_file: path.join(LOG_DIR, "taker1-bot-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
      env: {
        BOT_ENV_FILE: ".env.taker1",
        BOT_NAME: "taker1-bot",
        CONTROL_SOCKET_DIR: "/tmp",
      },
    },
    {
      name: "maker2-bot",
      script: "./trading_bot.sh",
      interpreter: "/bin/bash",
      kill_timeout: 30000,
      out_file: path.join(LOG_DIR, "maker2-bot.log"),
      error_file: path.join(LOG_DIR, "maker2-bot-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
      env: {
        BOT_ENV_FILE: ".env.maker2",
        BOT_NAME: "maker2-bot",
        CONTROL_SOCKET_DIR: "/tmp",
      },
    },
    {
      name: "taker2-bot",
      script: "./trading_bot.sh",
      interpreter: "/bin/bash",
      kill_timeout: 30000,
      out_file: path.join(LOG_DIR, "taker2-bot.log"),
      error_file: path.join(LOG_DIR, "taker2-bot-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
      env: {
        BOT_ENV_FILE: ".env.taker2",
        BOT_NAME: "taker2-bot",
        CONTROL_SOCKET_DIR: "/tmp",
      },
    },
    {
      name: "maker3-bot",
      script: "./trading_bot.sh",
      interpreter: "/bin/bash",
      kill_timeout: 30000,
      out_file: path.join(LOG_DIR, "maker3-bot.log"),
      error_file: path.join(LOG_DIR, "maker3-bot-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
      env: {
        BOT_ENV_FILE: ".env.maker3",
        BOT_NAME: "maker3-bot",
        CONTROL_SOCKET_DIR: "/tmp",
      },
    },
    {
      name: "taker3-bot",
      script: "./trading_bot.sh",
      interpreter: "/bin/bash",
      kill_timeout: 30000,
      out_file: path.join(LOG_DIR, "taker3-bot.log"),
      error_file: path.join(LOG_DIR, "taker3-bot-error.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss.SSS Z",
      env: {
        BOT_ENV_FILE: ".env.taker3",
        BOT_NAME: "taker3-bot",
        CONTROL_SOCKET_DIR: "/tmp",
      },
    },
  ],
};

/*
Start all bots with:

  pm2 start bots.config.cjs

Start a single bot with:

  pm2 start bots.config.cjs --only maker1-bot

Start multiple bots with:

  pm2 start bots.config.cjs --only maker1-bot,taker1-bot

Then to stop a specific bot:

  pm2 stop maker1-bot

To stop all bots:

  pm2 stop bots.config.cjs
* */
