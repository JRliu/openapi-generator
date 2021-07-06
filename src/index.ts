import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIObject } from 'openapi3-ts';
import { s2o, fixSwagger, fixOpenAPI, requestData, CommonError } from './util';
import { hadZh, formatWord } from './util/const';
import { ServiceGenerator, GenConfig } from './ServiceGenerator';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import PQueue from 'p-queue';
import chalk from 'chalk';
import * as reserved from 'reserved-words';
import { prettier } from './util/const';

export const TencentCloudConfig = {
  secretId: '',
  secretKey: '',
};

export function configure(cfg: { tencentCloudSecretId?: string; tencentCloudSecretKey?: string }) {
  const { tencentCloudSecretId, tencentCloudSecretKey } = cfg;
  if (tencentCloudSecretId && tencentCloudSecretKey) {
    TencentCloudConfig.secretId = tencentCloudSecretId;
    TencentCloudConfig.secretKey = tencentCloudSecretKey;
  }
}

let _translateClient: any = null;

function getTranslateClient() {
  if (_translateClient) {
    return _translateClient;
  }
  const { secretId, secretKey } = TencentCloudConfig;
  if (!secretId || !secretKey) {
    return null;
  }
  const TmtClient = tencentcloud.tmt.v20180321.Client;

  const clientConfig = {
    credential: {
      secretId,
      secretKey,
    },
    region: 'ap-guangzhou',
    profile: {
      httpProfile: {
        endpoint: 'tmt.tencentcloudapi.com',
      },
    },
  };

  const translateClient = new TmtClient(clientConfig);
  _translateClient = translateClient;
  return translateClient;
}

export class CliConfig extends GenConfig {
  api?: string;
  saveOpenAPIData?: boolean;
  autoClear?: boolean = true;
  /** 自动清除旧文件时忽略列表 */
  ignoreDelete?: string[] = [];
}

export async function genSDK(cfg: string | CliConfig | CliConfig[]) {
  let configs: CliConfig[] = [];

  if (typeof cfg === 'object' && !Array.isArray(cfg)) {
    cfg = [cfg];
  }

  (cfg as CliConfig[]).slice().forEach(c => {
    if (typeof c === 'string') {
      let cfgData = require(c);
      if ((configs as any).__esModule) {
        cfgData = (configs as any).default;
      }
      configs.push(...[].concat(cfgData));
    } else if (typeof c === 'object') {
      configs.push(c);
    } else {
      throw new CommonError(`fail load config: ${c}`);
    }
  });

  return Promise.all(
    configs.map(cfg => {
      cfg = {
        ...new CliConfig(),
        ...cfg,
      };
      cfg.sdkDir = getAbsolutePath(cfg.sdkDir!);
      cfg.interfaceTemplatePath = getAbsolutePath(cfg.interfaceTemplatePath!);
      cfg.templatePath = getAbsolutePath(cfg.templatePath!);
      return genFromUrl(cfg);
    })
  );
}

export async function genFromData(config: CliConfig, data: OpenAPIObject) {
  config = {
    ...new CliConfig(),
    ...config,
  };

  if (!data || !data.paths || !data.info) {
    throw new CommonError(`数据格式不正确 ${config.api}`);
  }

  mkdir(config.sdkDir!);

  if (config.saveOpenAPIData) {
    fs.writeFileSync(
      path.join(config.sdkDir!, 'origin.json'),
      JSON.stringify(data, null, 2),
      'utf8'
    );
  }

  if (data.swagger === '2.0') {
    data = await convertSwagger2OpenAPI(data);
  } else {
    fixOpenAPI(data);
  }

  if (!data.openapi || !data.openapi.startsWith('3.')) {
    throw new CommonError('数据格式不正确，仅支持 OpenAPI 3.0/Swagger 2.0');
  }

  if (config.autoClear && fs.existsSync(config.sdkDir!)) {
    fs.readdirSync(config.sdkDir!).forEach(file => {
      if (!['d.ts', '.ts', '.js'].some(ext => path.extname(file) === ext)) {
        return;
      }
      const absoluteFilePath = path.join(config.sdkDir!, '/', file);
      if ((config.ignoreDelete || []).indexOf(file) === -1 && absoluteFilePath !== file) {
        fs.unlinkSync(absoluteFilePath);
      }
    });
  }

  if (config.saveOpenAPIData) {
    fs.writeFileSync(path.join(config.sdkDir!, 'oas.json'), JSON.stringify(data, null, 2), 'utf8');
  }

  const generator = new ServiceGenerator(config, data);
  await generator.genFile();
}

export async function convertSwagger2OpenAPI(data: OpenAPIObject) {
  fixSwagger(data);
  data = await s2o(data);
  fixOpenAPI(data);
  return data;
}

export async function translateTexts(textArr: string[]) {
  const translateClient = getTranslateClient();

  if (!translateClient) {
    return {};
  }

  const getParam = (text: string) => ({
    SourceText: text,
    Source: 'zh',
    Target: 'en',
    ProjectId: 0,
  });

  // 限制每秒并发
  const LIMIT = 2;

  const translateTasks = [] as (() => Promise<any>)[];
  const result = {} as Record<string, string>;
  const iteratorFn = async (k: string) => {
    let t = '';
    // 分词，将单词首字母变为大写
    if (hadZh(k)) {
      // 如果key是中文，则增加翻译任务
      translateTasks.push(async () => {
        const res = await translateClient.TextTranslate(getParam(k));
        t = formatWord(res.TargetText);

        result[k] = t;
      });
    }
  };

  textArr.forEach(k => iteratorFn(k));

  const queue = new PQueue({
    concurrency: LIMIT,
    interval: 1000,
    intervalCap: LIMIT,
    //   carryoverConcurrencyCount: true,
  });
  await queue.addAll(translateTasks);

  return result;
}

export async function genFromUrl(config: CliConfig) {
  try {
    const res = await requestData(config.api!);
    let data = res;
    if (typeof res === 'string') {
      data = JSON.parse(res);
    }
    // 翻译data['definitions']中的中文key
    let definitions = data.definitions as Pick<string, any>;

    const kArr = Object.keys(definitions);

    const translatedZhObjs = await translateTexts(kArr);

    const iteratorFn = async (k: string) => {
      let typeName = formatWord(k);

      // @ts-ignore
      definitions[k].typeName = translatedZhObjs[k] ? translatedZhObjs[k] : typeName;
    };

    kArr.forEach(k => iteratorFn(k));

    return await genFromData(config, data);
  } catch (error) {
    console.warn(config.api, error);
    throw error;
  }
}

function getAbsolutePath(filePath: string) {
  return filePath
    ? path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath)
    : filePath;
}

function mkdir(dir: string) {
  if (!fs.existsSync(dir)) {
    mkdir(path.dirname(dir));
    fs.mkdirSync(dir);
  }
}

/**
 * hack filter 给api增加一个属性
 * https://github.com/zhang740/openapi-generator/blob/master/lib/ServiceGenerator.ts#L96
 */
function getApiPrefix(prefix: string) {
  return [
    (api: Record<string, any>) => {
      api.prefix = prefix;
      return true;
    },
  ];
}

/**
 * 添加一个方法的名称
 */
function addApiNs() {
  return [
    (api: Record<string, any>) => {
      api.ns = '';
      if (api.tags && api.tags.length) {
        api.ns = String(api.tags[0]).replace('Controller', '');
      }
      return true;
    },
  ];
}

function convertModuleName(name: string) {
  // 转换js保留关键字
  if (reserved.check(name)) {
    return `${name}Api`;
  }
  return name;
}

// 生成每个模块的 index.ts
function createIndex(sdkPath: string) {
  let files = fs
    .readdirSync(sdkPath)
    .filter(v => !v.includes('.d.ts'))
    .map(v => {
      let fileName = path.basename(v).replace(path.extname(v), '');

      // 如果有模块就叫index，为避免冲突，将该模块的文件名改成indexModule
      if (['index'].includes(fileName)) {
        fs.renameSync(`${sdkPath}/${fileName}.ts`, `${sdkPath}/${fileName}Module.ts`);
        fileName = fileName + 'Module';
      }

      return fileName;
    });
  let code = '';
  files.forEach(file => {
    code += `import * as ${convertModuleName(file)} from './${file}'\n`;
  });

  code += `
    export {
        ${files.map(convertModuleName).join(',\n')}
    }
    `;

  fs.writeFileSync(path.join(sdkPath, 'index.ts'), prettier(code), 'utf8');
}

export interface Config extends CliConfig {
  /** 参数类型的模板的地址 */
  paramInterfaceTemplatePath: string;
  /** 在每个请求的请求地址前加的前缀 */
  prefix?: string;

  beforeParseSwagger?: (data: any) => any;
}

const baseConfig: Pick<
  Config,
  'paramInterfaceTemplatePath' | 'templatePath' | 'interfaceTemplatePath' | 'camelCase'
> = {
  paramInterfaceTemplatePath: path.join(__dirname, './template/paramTP.njk'),
  templatePath: path.join(__dirname, './template/service.function.njk'),
  interfaceTemplatePath: path.join(__dirname, './template/interface.njk'),
  camelCase: 'lower',
};

export async function gen(customConfigs: Partial<Config>[]) {
  let configs = [] as Config[];

  configs = customConfigs.map(config => {
    let filters = addApiNs();

    if (config.prefix) {
      filters = filters.concat(getApiPrefix(config.prefix));
    }

    if (config.filter) {
      // @ts-ignore
      filters = filters.concat(config.filter);
    }

    config.filter = [
      api => {
        for (const fun of filters) {
          if (typeof fun === 'function') {
            if (!fun(api)) {
              return false;
            }
            // @ts-ignore
          } else if (!fun.test(api.path)) {
            return false;
          }
        }
        return true;
      },
    ];

    return { ...baseConfig, ...config };
  }) as Config[];

  console.log(chalk.yellow('生成 api 文件...'));

  let sdkPaths = [] as string[];
  let tasks = [] as Promise<any>[];
  let errorPath = [] as string[];
  configs.forEach((config: Config) => {
    tasks.push(
      genSDK(config)
        .then(res => {
          sdkPaths.push(config.sdkDir!);
          return res;
        })
        .catch(err => {
          console.log(err);
          errorPath.push(config.sdkDir!);
        })
    );
  });

  await Promise.all(tasks);

  console.log(chalk.yellow('生成 index.ts...'));
  sdkPaths.sort();
  sdkPaths.forEach(sdkPath => {
    createIndex(sdkPath);
  });

  if (errorPath.length) {
    console.log(chalk.red('以下 api 生成失败'));
    errorPath.forEach(v => {
      console.log(v);
    });
    console.log(chalk.green('以下 api 生成成功'));
    sdkPaths.forEach(v => {
      console.log(v);
    });
  } else {
    console.log(chalk.green('文档生成成功'));
  }
}
