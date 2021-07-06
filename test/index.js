const { gen, configure } = require('../dist/index');

const path = require('path');

const apiConfig = [
  {
    // api: 'https://petstore.swagger.io/v2/swagger.json',
    api: 'http://10.50.7.201:8180/v2/api-docs?group=SR-APP',
    // api: 'http://10.50.7.201:8180/v2/api-docs?group=SR-APP',
    sdkDir: path.join(__dirname, './src/api/operate'),
    namespace: 'OperateApi',
    // templatePath: path.join(__dirname, './service.function.njk'),
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
  },
];

configure({
  //   tencentCloudSecretId: 'asfdsf132',
  //   tencentCloudSecretKey: 'afdsrwe123',
});
gen(apiConfig);
