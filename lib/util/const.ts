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
