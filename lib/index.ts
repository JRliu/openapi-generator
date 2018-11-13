import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIObject, PathItemObject, OperationObject } from 'openapi3-ts';
import { s2o, fixRefSwagger, requestData } from './util';
import { ServiceGenerator, GenConfig } from './ServiceGenerator';

export interface CliConfig extends GenConfig {
  api: string;
  saveOpenAPIData?: boolean;
}

export async function genSDK(cfgPath: string) {
  let configs: CliConfig[];
  configs = require(cfgPath);
  if ((configs as any).__esModule) {
    configs = (configs as any).default;
  }
  configs = [].concat(configs);
  console.log('[GenSDK] read config as js');

  return Promise.all(configs.map(cfg => {
    cfg = {
      ...new GenConfig,
      ...cfg,
    };
    cfg.sdkDir = getAbsolutePath(cfg.sdkDir);
    cfg.interfaceTemplatePath = getAbsolutePath(cfg.interfaceTemplatePath);
    cfg.templatePath = getAbsolutePath(cfg.templatePath);
    return genFromUrl(cfg);
  }));
}

export async function genFromUrl(config: CliConfig) {
  console.log('[GenSDK] load', config.api);
  let data: OpenAPIObject = JSON.parse(await requestData(config.api));

  if (!data || !data.paths || !data.info) {
    throw new Error('数据格式不正确');
  }

  if (data.swagger === '2.0') {
    fixRefSwagger(data);
    data = await s2o(data);

    Object.keys(data.paths).forEach((p) => {
      const pathItem: PathItemObject = data.paths[p];
      Object.keys(pathItem).forEach((key) => {
        const method: OperationObject = pathItem[key];
        if (method && method.tags && method.tags.length) {
          method.tags = method.tags.map((tag) => {
            const tagItem = data.tags!.find((t) => t.name === tag);
            if (!tagItem || !tagItem.description) {
              return tag;
            }
            return tagItem.description.replace(/ /g, '');
          });
        }
      });
    });
  }

  if (!data.openapi || !data.openapi.startsWith('3.')) {
    throw new Error('数据格式不正确，仅支持 OpenAPI 3.0/Swagger 2.0');
  }

  if (fs.existsSync(config.sdkDir)) {
    fs.readdirSync(config.sdkDir).forEach((file) => {
      if (!['d.ts', '.ts', '.js'].some(ext => path.extname(file) === ext)) {
        return;
      }
      const absoluteFilePath = path.join(config.sdkDir, '/', file);
      if ((config.ignoreDelete || []).indexOf(file) === -1 && absoluteFilePath !== file) {
        fs.unlinkSync(absoluteFilePath);
      }
    });
  }

  if (config.saveOpenAPIData) {
    mkdir(config.sdkDir);
    fs.writeFileSync(
      path.join(config.sdkDir, 'oas.json'),
      JSON.stringify(data, null, 2),
      'utf8'
    );
  }

  const generator = new ServiceGenerator(config, data);
  generator.genFile();
}

function getAbsolutePath(filePath: string) {
  return filePath ?
    path.isAbsolute(filePath) ?
      path.join(process.cwd(), filePath) :
      filePath
    : filePath;
}

function mkdir(dir: string) {
  if (!fs.existsSync(dir)) {
    mkdir(path.dirname(dir));
    fs.mkdirSync(dir);
  }
}
