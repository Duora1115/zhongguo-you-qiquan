# 中国有期权

A 股 ETF 期权策略工作台。点选期权腿，看实时行情、到期损益和当前理论收益曲线。

行情来自新浪公开接口，只用于看盘和测算，不连接券商，也不能下单。

## 能做什么

- 覆盖上证 50、沪深 300、中证 500、科创 50、创业板等 ETF 期权
- T 型报价链，红涨绿跌
- 多腿组合：买卖、数量，实时算组合市值
- 到期损益图，标出各腿行权价；可看当前理论价值
- 日期和隐含波动率滑杆，Black-Scholes 希腊值
- 底部抽屉拉开看曲线，合上仍能浏览期权链

## 本地运行

需要 Node.js 20 或以上。

```bash
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:8080`。

```bash
npm run typecheck
npm test
npm run build
```

没有配置数据库时，预览使用内存数据库。部署环境若提供 `DATABASE_URL`，启动时会跑 `migrations/`。

## 安卓

壳工程在 `android/`，包名 `app.qiheng.android`。网页打进 WebView 之前先执行：

```bash
npm run build:apk
```

再用 Android SDK 编签名包。发布证书 `qiheng-release.keystore` 没有放进仓库；`android/app/build.gradle` 里的 `qiheng-demo` 只是本地演示密码，没有证书文件签不出包。

## iOS

工程在 `ios/Qiheng.xcodeproj`，和安卓共用同一套页面。苹果包必须在 Mac 上用自己的 Apple ID 签名：

1. 安装 Xcode，打开 `ios/Qiheng.xcodeproj`。
2. 在 Signing 里选择你的 Apple ID。
3. 数据线连接 iPhone，选中这台设备后运行。

页面改过之后，把新的网页资源放到 `ios/App/www`，再在 Xcode 里运行一次。更细的步骤见 [ios/安装说明.txt](ios/安装说明.txt)。

## 说明

测算结果依赖公开行情和模型假设，不是交易建议，也不保证与交易所结算价一致。
