import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIObject } from 'openapi3-ts';
import { s2o, fixSwagger, fixOpenAPI, requestData, CommonError } from './util';
// import { hadZh } from './util/const';
import { ServiceGenerator, GenConfig } from './ServiceGenerator';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
// import PQueue from 'p-queue';

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
      secretId: TencentCloudConfig.secretId || 'AKID60e17wUlmWzA4i5AyWmlTv60dz4sPfeL',
      secretKey: TencentCloudConfig.secretKey || 'RbU6RUGl34oHTO1MPBfspUszpOffOr3x',
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
  console.log(translateClient, getParam);

  //   function asyncPool(poolLimit: number, array: any[], iteratorFn: (...arg: any) => Promise<any>) {
  //     let i = 0;
  //     const ret = [] as Promise<any>[];
  //     const executing = [] as Promise<any>[];
  //     const enqueue: () => Promise<any> = () => {
  //       // 边界处理，array为空数组
  //       if (i === array.length) {
  //         return Promise.resolve();
  //       }
  //       // 每调一次enqueue，初始化一个promise
  //       const item = array[i++];
  //       const p = Promise.resolve().then(() => iteratorFn(item, array));
  //       // 放入promises数组
  //       ret.push(p);
  //       // promise执行完毕，从executing数组中删除
  //       const e = p.then(() => executing.splice(executing.indexOf(e), 1)) as Promise<any>;
  //       // 插入executing数字，表示正在执行的promise
  //       executing.push(e);
  //       // 使用Promise.rece，每当executing数组中promise数量低于poolLimit，就实例化新的promise并执行
  //       let r = Promise.resolve();
  //       if (executing.length >= poolLimit) {
  //         r = Promise.race(executing);
  //       }
  //       // 递归，直到遍历完array
  //       return r.then(() => enqueue());
  //     };
  //     return enqueue().then(() => Promise.all(ret));
  //   }

  try {
    const data = await JSON.parse(await requestData(config.api!));
    // 翻译data['definitions']中的中文key
    // 最多并发5条
    // const LIMIT = 4;
    // let definitions = data.definitions as Pick<string, any>;
    // const translateTasks = Object.keys(definitions).map(k => {
    //   return async () => {
    //     let newK = k;
    //     const val = definitions[k];
    //     if (hadZh(k)) {
    //       delete definitions[k];
    //       newK = await translateClient.TextTranslate(getParam(k));
    //     }

    //     definitions[newK] = val;
    //   };
    // });
    // await Promise.all(translateTasks);\

    // const sleep = (timeout: number) => {
    //   return new Promise(rs => {
    //     setTimeout(() => {
    //       rs(timeout);
    //     }, timeout);
    //   });
    // };

    // const iteratorFn = async (k: string) => {
    //   let typeName = k;
    //   //   const val = definitions[k];
    //   if (hadZh(k)) {
    //     // delete definitions[k];
    //     // await sleep(500);
    //     const res = await translateClient.TextTranslate(getParam(k));
    //     typeName = res.TargetText.replace('-', ' ');
    //     let nameStrs = typeName.split(' ');
    //     nameStrs = nameStrs.map(n => {
    //       return `${n[0].toUpperCase()}${n.slice(1)}`;
    //     });
    //     typeName = nameStrs.join('');
    //   }
    //   // @ts-ignore
    //   definitions[k].typeName = typeName;

    //   //   definitions[newK] = val;
    // };

    // const kArr = Object.keys(definitions);
    // await asyncPool(1, kArr, iteratorFn);
    // const queue = new PQueue({
    //   concurrency: LIMIT,
    //   interval: 1000,
    //   intervalCap: LIMIT,
    // });
    // const results = await queue.addAll(kArr.map(k => iteratorFn.bind(null, k)));

    // console.log(results, '=====result');

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

genSDK({
  //   api: 'https://petstore.swagger.io/v2/swagger.json',
  api: 'http://10.50.7.201:8080/v2/api-docs?group=SR-APP',
  sdkDir: path.join(__dirname, './src/api/pet'),
  namespace: 'Pet',
  filter: [
    // (api) => {
    //     const allowPrePaths = ['/api/v1/pet/']
    //     api.ns = ''
    //     if (api.tags && api.tags.length) {
    //         api.ns = String(api.tags[0] || '').replace('Controller', '')
    //         // api.tags[0] = api.ns
    //     }
    //     const apiPath = String(api.path)
    //     for (const allow of allowPrePaths) {
    //         if (apiPath.startsWith(allow)) {
    //             return true
    //         }
    //     }
    //     return false
    // },
  ],
});
