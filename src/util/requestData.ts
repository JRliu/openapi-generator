import * as superagent from 'superagent';

export async function requestData(url: string) {
  try {
    const response = await superagent.get(url).timeout(5000);

    if (response && response.statusCode !== 200) {
      console.warn('[GenSDK] err', response.error);
      // @ts-ignore
      throw new Error(response);
    }
    return response.body;
  } catch (error) {
    console.warn('[GenSDK] err', error);
    throw error;
  }
}
