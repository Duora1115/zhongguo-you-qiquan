export function getMarket(): Promise<never> {
  return Promise.reject(new Error("安装包不走网页服务"));
}
