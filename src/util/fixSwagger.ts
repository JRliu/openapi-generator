import { CommonError } from './error';
import { renameTypePrefix, testTypeNameValid } from './const';

const swaggerDefPrefix = '#/definitions/';
const openApiDefPrefix = '#/components/schemas/';

export function fixSwagger(data: any) {
  fixRefName(data);
  fixRequestBody(data);
}

function fixRefName(data: any) {
  const refMap: { [key: string]: any[] } = {};
  let definitions = data.definitions || {};
  Object.keys(definitions).forEach(key => {
    refMap[key] = [];
  });
  if (data.components && data.components.schemas) {
    Object.keys(data.components.schemas).forEach(key => {
      refMap[key] = [];
    });
    definitions = {
      ...definitions,
      ...data.components.schemas,
    };
  }

  findRef(data).forEach(refItem => {
    const $ref: string = refItem.$ref;

    if (!$ref.startsWith(swaggerDefPrefix) && !$ref.startsWith(openApiDefPrefix)) {
      throw new CommonError(`未实现解析: ${$ref}`);
    }
    const key = $ref.replace(swaggerDefPrefix, '').replace(openApiDefPrefix, '');
    if (!refMap[key]) {
      console.warn(`未找到类型定义: ${$ref}`);
      delete refItem.$ref;
      refItem.type = 'any';
      return;
    }
    refMap[key].push(refItem);
  });

  let count = 0;
  Object.keys(refMap).forEach(key => {
    if (!testTypeNameValid(key)) {
      let newName = data.definitions[key].typeName;
      //   let newName = key.replace(/[^a-zA-Z0-9_]/g, '_');
      newName = data.definitions[newName] ? `${renameTypePrefix}${count}` : newName;

      data.definitions[newName] = data.definitions[key];
      delete data.definitions[key];

      refMap[key].forEach(refItem => {
        refItem.$ref = `${swaggerDefPrefix}${newName}`;
      });
      count++;
    }
  });
}

function fixRequestBody(data: any) {
  const paths = data.paths;
  Object.keys(paths).forEach(path => {
    const pathItemObject = paths[path];
    Object.keys(pathItemObject).forEach(method => {
      const parameters: any[] = pathItemObject[method].parameters;
      if (parameters) {
        const bodyParams = parameters.filter(p => p.in === 'body');
        switch (method.toUpperCase()) {
          case 'POST':
          case 'PUT':
            if (bodyParams.length > 1) {
              const properties: any = {};
              bodyParams.forEach(p => {
                properties[p.name] = {
                  description: p.description,
                  ...p.schema,
                };
              });

              const dtoName = 'RequestBodyDTO';
              pathItemObject[method].parameters = parameters
                .filter(p => p.in !== 'body')
                .concat({
                  in: 'body',
                  name: dtoName,
                  description: dtoName,
                  required: true,
                  schema: {
                    type: 'object',
                    required: bodyParams.filter(p => p.required).map(p => p.name),
                    properties,
                  },
                });
            }
            break;

          default:
            bodyParams.forEach(p => {
              p.in = 'query';
            });
            break;
        }
      }
    });
  });
}

function findRef(object: any) {
  // 考虑到 example
  if (!object || typeof object !== 'object') {
    return [];
  }

  if (object.$ref) {
    return [object];
  }
  const list: any[] = [];
  Object.keys(object).forEach(key => {
    if (typeof object === 'object') {
      list.push(...findRef(object[key]));
    }
  });
  return list;
}
