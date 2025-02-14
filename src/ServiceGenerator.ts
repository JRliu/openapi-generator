const debug = require('debug')('openapi-generator');
import * as fs from 'fs';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import { prettier } from './util/const';
import {
  OpenAPIObject,
  SchemaObject,
  ReferenceObject,
  ParameterObject,
  RequestBodyObject,
  ContentObject,
  ResponseObject,
  ResponsesObject,
  OperationObject,
  PathItemObject,
} from 'openapi3-ts';
import { CommonError } from './util';

export class GenConfig {
  /** 生成目录 */
  sdkDir?: string;
  /** Service模板文件路径 */
  templatePath?: string;
  /** Interface模板文件路径 */
  interfaceTemplatePath?: string;
  /** 参数Interface模板文件路径 */
  paramInterfaceTemplatePath?: string;
  /** filename style, true 为大驼峰，lower 为小驼峰 */
  camelCase?: boolean | 'lower' = false;
  /** gen type */
  type?: 'ts' | 'js' = 'ts';
  /** 生成 Service 类型 */
  serviceType?: 'function' | 'class' = 'function';
  /** 复杂类型命名空间 */
  namespace?: string = 'API';
  /** 数据处理钩子 */
  hook?: {
    /** 自定义函数名称 */
    customFunctionName?: (data: OperationObject) => string;
    /** 自定义类名 */
    customClassName?: (tagName: string) => string;
  } = {};
  /** path过滤 */
  filter?: (RegExp | ((data: APIDataType) => boolean))[];
}

export interface APIDataType extends OperationObject {
  path: string;
  method: string;
}

export interface TagAPIDataType {
  [tag: string]: APIDataType[];
}

export class ServiceGenerator {
  protected apiData: TagAPIDataType = {};

  constructor(protected config: GenConfig, protected openAPIData: OpenAPIObject) {
    Object.keys(openAPIData.paths || {}).forEach(path => {
      const pathItem: PathItemObject = openAPIData.paths[path];

      ['get', 'put', 'post', 'delete'].forEach(method => {
        const operationObject: OperationObject = pathItem[method];
        if (operationObject) {
          operationObject.tags!.forEach(tag => {
            if (!this.apiData[tag]) {
              this.apiData[tag] = [];
            }
            this.apiData[tag].push({
              path,
              method,
              ...operationObject,
            });
          });
        }
      });
    });
  }

  genFile() {
    const data = this.getServiceTP().filter(tp => {
      tp.list = tp.list.filter(
        item =>
          !this.config.filter ||
          this.config.filter.some(f => {
            return f instanceof RegExp
              ? f.test(item.path)
              : typeof f === 'function'
              ? f(item)
              : true;
          })
      );
      return tp.list.length;
    });

    // 生成interface
    if (this.config.type === 'ts') {
      debug('[GenSDK] gen interface.');

      const template = this.getTemplate('paramInterface');
      const paramInterfaceContent = nunjucks.renderString(template, {
        namespace: this.config.namespace,
        list: data,
      });

      this.genFileFromTemplate(
        'typings.d.ts',
        'interface',
        {
          namespace: this.config.namespace,
          list: this.getInterfaceTP(),
        },
        paramInterfaceContent
      );
    }

    // 生成请求代码
    data.map(tp => {
      debug('[GenSDK] generate service:', tp.className);
      this.genFileFromTemplate(
        this.getFinalFileName(`${tp.className}.${this.config.type}`),
        'service',
        {
          namespace: this.config.namespace,
          ...tp,
        }
      );
    });
  }

  protected getInterfaceTP() {
    const components = this.openAPIData.components || {};
    const data = [components.schemas].map(defines => {
      return Object.keys(defines || {}).map(typeName => {
        try {
          const props: SchemaObject = this.resolveRefObject(defines![typeName]);
          if (props.type === 'string' && props.enum) {
            return {
              typeName,
              ...props,
              type: props.enum.map((v: string) => `"${v}"`).join(' | '),
            };
          }
          if (props.type !== 'object') {
            throw new CommonError(`Unsupported interface type: ${typeName}: ${props.type}`);
          }

          const requiredPropKeys = props.required || [];

          const propsData = props.properties
            ? Object.keys(props.properties).map(propName => {
                const propSchema: SchemaObject = props.properties![propName];
                return {
                  ...propSchema,
                  name: propName,
                  type: this.getType(propSchema),
                  desc: [propSchema.title, propSchema.description].filter(s => s).join(' '),
                  required: requiredPropKeys.some(key => key === propName),
                };
              })
            : [];
          if (props.additionalProperties) {
            if (props.additionalProperties === true) {
              propsData.push({
                name: '[key: string]',
                type: 'any',
                desc: '',
                required: true,
              });
            } else {
              propsData.push({
                name: '[key: string]',
                type: this.getType(props.additionalProperties),
                desc: (props.additionalProperties as SchemaObject).description!,
                required: true,
              });
            }
          }

          return {
            typeName,
            type: this.getType(props),
            props: propsData,
          };
        } catch (error) {
          console.warn('[GenSDK] gen interface param error:', error);
          throw error;
        }
      });
    });
    return data.reduce((p, c) => p.concat(c), []);
  }

  protected getServiceTP() {
    return Object.keys(this.apiData).map(tag => {
      // functionName tag级别防重
      const tmpFunctionRD: { [key: string]: number } = {};

      const genParams = this.apiData[tag]
        .filter(api => {
          // 暂不支持变量
          return !api.path.includes('${');
        })
        .map(api => {
          try {
            const params = this.getParamsTP(api.parameters);
            const body = this.getBodyTP(api.requestBody);
            const response = this.getResponseTP(api.responses);

            let functionName = this.config.hook!.customFunctionName
              ? this.config.hook!.customFunctionName(api)
              : api.operationId;

            if (tmpFunctionRD[functionName!]) {
              functionName = `${functionName}_${tmpFunctionRD[functionName!]++}`;
            } else {
              tmpFunctionRD[functionName!] = 1;
            }

            return {
              ...api,
              functionName,
              path: api.path.replace(/{([^}]*)}/gi, ({}, str) => {
                return `\$\{${str}\}`;
              }),
              method: api.method,
              desc: [api.summary, api.description].filter(s => s).join(' '),
              hasHeader: !!(params && params.header) || !!(body && body.mediaType),
              params,
              body,
              response,
            };
          } catch (error) {
            console.warn('[GenSDK] gen service param error:', error);
            throw error;
          }
        });

      const className = this.config.hook!.customClassName
        ? this.config.hook!.customClassName(tag)
        : this.toCamelCase(tag);
      return {
        genType: this.config.type,
        className,
        instanceName: `${className[0].toLowerCase()}${className.substr(1)}`,
        list: genParams,
      };
    });
  }

  protected getBodyTP(requestBody?: any) {
    const reqBody: RequestBodyObject = this.resolveRefObject(requestBody);
    if (!reqBody) {
      return;
    }
    const reqContent: ContentObject = reqBody.content;
    if (typeof reqContent !== 'object') {
      return;
    }
    const mediaType = Object.keys(reqContent)[0];
    if (!reqContent[mediaType]) {
      return;
    }
    const schema: SchemaObject = reqContent[mediaType].schema!;
    if (schema.type === 'object' && schema.properties) {
      return {
        mediaType,
        ...schema,
        propertiesList: Object.keys(schema.properties).map(p => ({
          key: p,
          schema: {
            ...schema.properties![p],
            type: this.getType(schema.properties![p], this.config.namespace),
          },
        })),
      };
    }
    return {
      mediaType,
      type: this.getType(schema, this.config.namespace),
    };
  }

  protected getResponseTP(responses?: ResponsesObject) {
    const response: ResponseObject = this.resolveRefObject(responses!.default || responses!['200']);
    const defaultResponse = {
      mediaType: '*/*',
      type: 'any',
    };
    if (!response) {
      return defaultResponse;
    }
    const resContent: ContentObject = response.content!;
    if (typeof resContent !== 'object') {
      return defaultResponse;
    }
    const mediaType = Object.keys(resContent)[0];
    const schema = resContent[mediaType].schema;
    return {
      mediaType,
      type: this.getType(schema!, this.config.namespace),
    };
  }

  protected getParamsTP(parameters?: (ParameterObject | ReferenceObject)[]) {
    if (!parameters || !parameters.length) {
      return;
    }
    const templateParams: { [key: string]: ParameterObject[] } = {};
    ['query', 'header', 'path', 'cookie'].forEach(source => {
      const params = parameters
        .map(p => this.resolveRefObject<ParameterObject>(p))
        .filter((p: ParameterObject) => p.in === source)
        .map(p => ({
          ...p,
          type: this.getType(p.schema!, this.config.namespace),
        }));

      if (params.length) {
        templateParams[source] = params;
      }
    });
    return templateParams;
  }

  protected genFileFromTemplate(
    fileName: string,
    type: 'interface' | 'service' | 'paramInterface',
    params: any,
    extendsContent = ''
  ) {
    try {
      const template = this.getTemplate(type);

      const content = prettier(nunjucks.renderString(template, params) + extendsContent);

      this.writeFile(fileName, content);
    } catch (error) {
      console.warn('[GenSDK] file gen fail:', fileName, 'type:', type);
      throw error;
    }
  }

  protected writeFile(fileName: string, content: string) {
    const filePath = path.join(this.config.sdkDir!, fileName);
    this.mkdir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, { encoding: 'utf8' });
  }

  protected getTemplate(type: 'interface' | 'service' | 'paramInterface') {
    let configFilePath = '';
    //       type === 'interface' ? this.config.interfaceTemplatePath : this.config.templatePath;
    const { interfaceTemplatePath, templatePath, paramInterfaceTemplatePath } = this.config;
    switch (type) {
      case 'interface':
        configFilePath = interfaceTemplatePath!;
        break;
      case 'service':
        configFilePath = templatePath!;
        break;
      case 'paramInterface':
        configFilePath = paramInterfaceTemplatePath!;
        break;
    }

    try {
      if (configFilePath) {
        this.mkdir(path.dirname(configFilePath));
        if (fs.existsSync(configFilePath)) {
          return fs.readFileSync(configFilePath, 'utf8');
        }
      }

      const fileContent = fs.readFileSync(
        path.join(
          __dirname,
          'template',
          type === 'service' ? `${type}.${this.config.serviceType}.njk` : `${type}.njk`
        ),
        'utf8'
      );
      if (configFilePath) {
        fs.writeFileSync(configFilePath, fileContent, 'utf8');
      }
      return fileContent;
    } catch (error) {
      console.warn(`[GenSDK] get {${type}} template fail:`, configFilePath);
      throw error;
    }
  }

  protected resolveRefObject<T>(refObject: any): T {
    if (!refObject || !refObject.$ref) {
      return refObject;
    }
    const refPaths = refObject.$ref.split('/');
    if (refPaths[0] === '#') {
      refPaths.shift();
      let obj: any = this.openAPIData;
      refPaths.forEach((node: any) => {
        obj = obj[node];
      });
      if (!obj) {
        throw new Error(`[GenSDK] Data Error! Notfoud: ${refObject.$ref}`);
      }
      return obj.$ref ? this.resolveRefObject(obj) : obj;
    }
    return refObject;
  }

  protected getRefName(refObject: any) {
    if (typeof refObject !== 'object' || !refObject.$ref) {
      return refObject;
    }
    const refPaths = refObject.$ref.split('/');
    return refPaths[refPaths.length - 1] as string;
  }

  protected mkdir(dir: string) {
    if (!fs.existsSync(dir)) {
      this.mkdir(path.dirname(dir));
      fs.mkdirSync(dir);
    }
  }

  protected getFinalFileName(fileName: string) {
    if (this.config.camelCase === true) {
      return this.toCamelCase(fileName);
    } else if (this.config.camelCase === 'lower') {
      fileName = this.toCamelCase(fileName);
      return `${fileName[0].toLowerCase()}${fileName.substr(1)}`;
    }
    return this.toHyphenCase(fileName);
  }

  protected toHyphenCase(s: string) {
    s = s.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (s.startsWith('_')) {
      s = s.substr(1);
    }
    return s;
  }

  protected toCamelCase(s: string) {
    return s.replace(/_(\w)/g, function (_all, letter) {
      return letter.toUpperCase();
    });
  }

  protected getType(schemaObject: SchemaObject, namespace: string = ''): string {
    // @ts-ignore
    if (!schemaObject && schemaObject !== 0) {
      return 'any';
    }
    if (typeof schemaObject !== 'object') {
      return schemaObject;
    }
    if (schemaObject.$ref) {
      return [namespace, this.getRefName(schemaObject)].filter(s => s).join('.');
    }

    let type = schemaObject.type;

    switch (schemaObject.format) {
      case 'float':
      case 'double':
      case 'int32':
      case 'int64':
        type = 'number';
        break;
    }

    if (schemaObject.enum) {
      type = 'enum';
    }

    switch (type) {
      case 'number':
      case 'int':
      case 'integer':
      case 'long':
      case 'float':
      case 'double':
        return 'number';

      case 'Date':
      case 'date':
      case 'dateTime':
      case 'date-time':
      case 'datetime':
        return 'Date';

      case 'string':
      case 'email':
      case 'password':
      case 'url':
      case 'byte':
      case 'binary':
        return 'string';

      case 'boolean':
        return 'boolean';

      case 'array':
        return `${this.getType(schemaObject.items!, namespace)}[]`;

      /** 以下非标准 */
      case 'enum':
        return Array.isArray(schemaObject.enum)
          ? Array.from(
              new Set(
                schemaObject.enum.map(v =>
                  typeof v === 'string' ? `"${v.replace(/"/g, '"')}"` : this.getType(v)
                )
              )
            ).join(' | ')
          : 'string';

      default:
        if (schemaObject.oneOf && schemaObject.oneOf.length) {
          return schemaObject.oneOf.map(item => this.getType(item, namespace)).join(' | ');
        }
        const props: string[] = [];
        if (schemaObject.properties) {
          Object.keys(schemaObject.properties).forEach(prop => {
            props.push(
              `${prop.includes('-') ? `"${prop}"` : prop}: ${this.getType(
                schemaObject.properties![prop],
                namespace
              )};`
            );
          });
        }
        if (schemaObject.additionalProperties) {
          const indexType = schemaObject.additionalProperties
            ? schemaObject.additionalProperties === true
              ? `{ type: 'any'; }`
              : this.getType(schemaObject.additionalProperties, namespace)
            : undefined;
          if (indexType) {
            props.push(`[key: string]: ${indexType};`);
          }
        }
        return props.length ? `{ ${props.join(' ')} }` : 'any';
    }
  }
}
