module.exports = {
    apps: [
        {
            name: "maker1-bot",
            script: "./trading_bot.sh",
            interpreter: "/bin/bash",
            kill_timeout: 30000,
            env: {
                BOT_ENV_FILE: ".env.maker1",
                BOT_NAME: "maker1-bot",
            },
        },
        {
            name: "taker1-bot",
            script: "./trading_bot.sh",
            interpreter: "/bin/bash",
            kill_timeout: 30000,
            env: {
                BOT_ENV_FILE: ".env.taker1",
                BOT_NAME: "taker1-bot",
            },
        },
        {
            name: "maker2-bot",
            script: "./trading_bot.sh",
            interpreter: "/bin/bash",
            kill_timeout: 30000,
            env: {
                BOT_ENV_FILE: ".env.maker2",
                BOT_NAME: "maker2-bot",
            },
        },
        {
            name: "taker2-bot",
            script: "./trading_bot.sh",
            interpreter: "/bin/bash",
            kill_timeout: 30000,
            env: {
                BOT_ENV_FILE: ".env.taker2",
                BOT_NAME: "taker2-bot",
            },
        },
        {
            name: "maker3-bot",
            script: "./trading_bot.sh",
            interpreter: "/bin/bash",
            kill_timeout: 30000,
            env: {
                BOT_ENV_FILE: ".env.maker3",
                BOT_NAME: "maker3-bot",
            },
        },
        {
            name: "taker3-bot",
            script: "./trading_bot.sh",
            interpreter: "/bin/bash",
            kill_timeout: 30000,
            env: {
                BOT_ENV_FILE: ".env.taker3",
                BOT_NAME: "taker3-bot",
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
