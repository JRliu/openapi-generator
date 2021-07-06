const program = require('commander');
const version = require('../../package.json').version;
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const lib = require('../index.js');

program
  .version(version)
  .option('-c, --config <config>', 'config path')
  .action(opt => {
    const c = opt.config;
    let configDir = '';
    if (c) {
      configDir = path.join(process.cwd(), c);
    } else {
      // 默认取项目根目录下的genapiconfig.js
      configDir = path.join(process.cwd(), './genapiconfig.js');
    }

    if (!fs.existsSync(configDir)) {
      console.log(chalk.red('错误的配置地址：' + configDir));
      return;
    }

    const { apiConfig, config } = require(configDir);

    if (config) {
      lib.configure({
        ...config,
      });
    }

    lib.gen(apiConfig);
  });

program.parse();
