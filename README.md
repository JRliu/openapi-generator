## openapi-genrator

根据 swagger 文档生成 api 代码及其类型

### 安装

```bash
yarn add @lauginwing/openapi-genrator
```

### 使用

- cli 使用

```bash
openapi-gen -c ./config.js
// -c : 设定配置文件所在地址，不传则默认取终端当前目录下的genapiconfig.js

// 本地使用
npx openapi-gen -c ./config.js
```

- js 调用

```js
import { gen, configure } from '@lauginwing/openapi-genrator';
import apiConfig from './genapiconfig.ts';
configure({
  // 腾讯云的秘钥，用于翻译api文档中的中文模块名。可选
  tencentCloudSecretId: secretId,
  tencentCloudSecretKey: secretKey,
});

gen(apiConfig);
```

### 配置

一般情况下，只需配置前四项即可

例子

```js
// config.js
const path = require('path');

exports.apiConfig = [
  {
    api: `https://petstore.swagger.io/v2/swagger.json`,
    sdkDir: path.join(__dirname, './src/api/pet'),
    namespace: 'Pet',
    prefix: '/pet',
  },
];
```

完整类型:

> 参考 https://github.com/zhang740/openapi-generator#readme

```ts
interface ApiConfig {
  /** api文档地址 **/
  api: string;
  /** 生成目录 */
  sdkDir: string;
  /** 复杂类型命名空间 */
  namespace?: string;
  /** 在每个请求的请求地址前加的前缀 */
  prefix?: string;

  saveOpenAPIData?: boolean;

  autoClear?: boolean;
  /** 自动清除旧文件时忽略列表 */
  ignoreDelete?: string[];
  /** 参数类型的模板的地址 */
  paramInterfaceTemplatePath?: string;
  /** Service模板文件路径 */
  templatePath?: string;
  /** Interface模板文件路径 */
  interfaceTemplatePath?: string;
  /** 生成请求库 */
  requestLib?: boolean;
  /** filename style, true 为大驼峰，lower 为小驼峰 */
  camelCase?: boolean | 'lower';
  /** gen type */
  type?: 'ts' | 'js';
  /** 生成 Service 类型 */
  serviceType?: 'function' | 'class';
  /** 拿到 swagger json ，做前置处理，返回处理好的数据 **/
  beforeParseSwagger?: (data: SwaggerJSon | OpenApiJson) => Promise<SwaggerJSon | OpenApiJson>;
  /** 数据处理钩子 */
  hook?: {
    /** 自定义函数名称 */
    customFunctionName?: (data: OperationObject) => string;
    /** 自定义类名 */
    customClassName?: (tagName: string) => string;
  };
  /** path过滤 */
  filter?: (RegExp | ((data: APIDataType) => boolean))[];
}

interface Config {
  tencentCloudSecretId: string;
  tencentCloudSecretKey: string;
}
```
