import * as superagent from 'superagent';

export async function requestData(url: string) {
  //   return new Promise<string>((resolve, reject) => {
  //     request(url, { timeout: 5000 }, (error, response, body) => {
  //       if (error) {
  //         console.warn('[GenSDK] err', error);
  //         reject(error);
  //       }
  //       if (response && response.statusCode !== 200) {
  //         console.warn('[GenSDK] err', error);
  //         reject(new Error(response.statusMessage));
  //       }
  //       resolve(body);
  //     });
  //   });

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
