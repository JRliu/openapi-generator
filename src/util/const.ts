import * as Prettier from 'prettier';

export const renameTypePrefix = 'DTO_';
export function testTypeNameValid(name: string) {
  return /^[a-zA-Z0-9_]*$/.test(name);
}

/**
 * 是否含有中文
 * @param str
 * @returns
 */
export function hadZh(str: string) {
  return /.*[\u4e00-\u9fa5]+.*/.test(str);
}

/**
 * 格式化单词，去掉非字母和数字，驼峰
 * @param str
 * @returns
 */
export function formatWord(str: string) {
  if (hadZh(str)) {
    return str;
  }

  let t = str.replace(/[^0-9a-zA-Z]+/g, '-');
  let tStrs = t.split('-');
  tStrs = tStrs.map(n => {
    if (!n) {
      return '';
    }
    return `${n[0].toUpperCase()}${n.slice(1)}`;
  });

  t = tStrs.join('');
  return t;
}

export function prettier(str: string) {
  return Prettier.format(str, {
    singleQuote: true,
    semi: false,
    parser: 'typescript',
    tabWidth: 4,
    printWidth: 80,
  });
}
