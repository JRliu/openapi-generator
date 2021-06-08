import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIObject } from 'openapi3-ts';
import { s2o, fixSwagger, fixOpenAPI, requestData, CommonError } from './util';
import { hadZh } from './util/const';
import { ServiceGenerator, GenConfig } from './ServiceGenerator';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import PQueue from 'p-queue';

export const TencentCloudConfig = {
  secretId: '',
  secretKey: '',
};

export function config(cfg: { tencentCloudSecretId?: string; tencentCloudSecretKey?: string }) {
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
  const TmtClient = tencentcloud.tmt.v20180321.Client;

  const clientConfig = {
    credential: {
      secretId: TencentCloudConfig.secretId,
      secretKey: TencentCloudConfig.secretKey,
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
      if (
        !['d.ts', '.ts', '.js'].some(ext => path.extname(file) === ext) ||
        (config.requestLib && file.startsWith('base.'))
      ) {
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

export async function genFromUrl(config: CliConfig) {
  const translateClient = getTranslateClient();
  const getParam = (text: string) => ({
    SourceText: text,
    Source: 'zh',
    Target: 'en',
    ProjectId: 0,
  });

  try {
    const res = await requestData(config.api!);
    let data = res;
    if (typeof res === 'string') {
      data = JSON.parse(res);
    }
    // 翻译data['definitions']中的中文key
    // 限制每秒并发
    const LIMIT = 2;
    let definitions = data.definitions as Pick<string, any>;

    const translateTasks = [] as (() => Promise<any>)[];

    const iteratorFn = async (k: string) => {
      let typeName = k.replace(/[\s«»<>《》]/g, '_');
      // 分词，将单词首字母变为大写
      if (hadZh(k)) {
        // 如果key是中文，则增加翻译任务
        translateTasks.push(async () => {
          const res = await translateClient.TextTranslate(getParam(k));
          typeName = res.TargetText.replace('-', ' ');
          let nameStrs = typeName.split(' ');
          nameStrs = nameStrs.map(n => {
            return `${n[0].toUpperCase()}${n.slice(1)}`;
          });
          typeName = nameStrs.join('').replace(/\s/g, '');

          // @ts-ignore
          definitions[k].typeName = typeName;

          return { [k]: typeName };
        });
      }
      // @ts-ignore
      definitions[k].typeName = typeName;
    };

    const kArr = Object.keys(definitions);

    kArr.forEach(k => iteratorFn(k));

    const queue = new PQueue({
      concurrency: LIMIT,
      interval: 1000,
      intervalCap: LIMIT,
      //   carryoverConcurrencyCount: true,
    });
    const results = await queue.addAll(translateTasks);

    console.log(results, '=====result');

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
