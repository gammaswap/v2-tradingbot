module.exports = {
    apps: [{
        name: "asset1-bot",
        script: "./asset1_bot.sh",
        interpreter: "/bin/bash",
        kill_timeout: 30000
    },{
        name: "asset2-bot",
        script: "./asset2_bot.sh",
        interpreter: "/bin/bash",
        kill_timeout: 30000
    },{
        name: "asset3-bot",
        script: "./asset3_bot.sh",
        interpreter: "/bin/bash",
        kill_timeout: 30000
    }]
};

/*
Start it with:

  pm2 start ecosystem.config.cjs

Then:

  pm2 stop asset1-bot
* */