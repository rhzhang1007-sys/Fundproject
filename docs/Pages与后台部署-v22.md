当前免费方案见[免费部署操作步骤v23](免费部署操作步骤-v23.md)，使用Render Free和Supabase Free，取代本文此前的付费磁盘建议。以下保留v22准备记录。

# GitHub Pages与后台部署 v22

2026-11-27。仅准备本地部署适配和说明，未创建托管服务，未推送本轮代码，未发布网站、未改TeamHub，不修改正在采集的WorkBuddy任务。

## 第一项和第三项还需要什么

选择Pages不要求重新采集已有资料。但当前静态目录1,144,416,896字节，大于Pages 1GB上限，发布包精简和全量公开数据的按需读取路径仍需完成并验收。不能把“数据已经有了”当作“Pages已可直接部署”。不删除大资料，保留资料仓库及版本配套。

GitHub Actions已配置、今日已实测。选择Pages不需要重做采集任务，正式网页发布后仍须用一轮真实日更验收“采集—提交—网页刷新”，并检查没有使用旧缓存。采集部分完成、未归属和原文缺失继续保留，不承诺全市场采齐。页面及后台代码更新不等于公开数据自动更新。

## 现在已经准备好的代码

- Dockerfile：同一运行环境安装Node 22、Python 3.12、curl、PDF和指数表格依赖，启动现有web-ai-server.mjs。不在容器中启动全市场定时采集。
- .dockerignore：只允许应用源码、运行依赖、公开配置和公开网页资料，不包含.env、私有目录、缓存、Git、浏览器存储或任务输出。
- deployment-config.mjs：公开的后台地址配置，默认空值沿用本机同源访问，绝不填写Key。
- service-api.mjs：AI、状态、新闻正文、单对象/整组补读和轮询统一指向后台。公开后台地址只接受HTTPS；允许本地HTTP测试。
- web-ai-server.mjs：分开校验网页来源与后台域名，支持精确来源的CORS预检，不开放通配或携带浏览器凭据；本机默认仍监听127.0.0.1，只有Docker显式监听0.0.0.0。新增/api/health。

## 后台具体部署到哪里

后台是现有Node/Python程序的运行位置，不需要在这里部署大模型。它通过API调用已选服务商，保管Key、执行预算控制并读取公开原文。可部署到老师已有的常驻服务器，或支持Docker的托管平台。WorkBuddy官方支持网站应用与云服务，但文档没有证明现有Python子进程能原样运行；这条路径仍需平台实测，不能承诺点击分享即可完成迁移。

下面提供Render作为可操作示例，不强制购买该平台，不创建账号或收费资源。它不意味着老师的TeamHub需要改动。

## Render操作步骤

1. 先将本轮已验证的公开代码提交到rhzhang1007-sys/Fundproject。当前文件仅在本机准备，尚未推送，不要直接开始部署旧远端版本。
2. 在Render登录自己的账号，新建Web Service，选择该仓库main分支，Language/Runtime选择Docker，Dockerfile路径为./Dockerfile，构建上下文为仓库根目录。初期关闭自动部署，避免论坛每15分钟提交引发重复构建。
3. Health Check Path填写/api/health。PORT由平台提供，Docker已经设置网络监听，不需要更改本机配置。
4. 选定服务后，平台会给出类似https://你的后台名称.onrender.com的地址。这里仅为格式示例，不是已创建的网址。
5. 在平台Environment私下填写后面的变量。API Key不要发到聊天、GitHub源码或网页中。GitHub Secrets不会自动传入这个服务。
6. 为正式共用AI保留持久存储，将磁盘挂载到/app/prototype/.private，单实例运行。用量账本、补读任务及原文缓存都在这个路径下。Render免费实例没有持久盘，重启会丢失这些文件，不能据此承诺共享预算连续或后台任务长期恢复；需要磁盘时先核实并自行选择付费方案。
7. 部署成功后，以后台实际地址请求/api/health，并在Pages前端填写API_ORIGIN，重新构建网页。不能只改后台环境变量而不改前端地址。
8. 从另一台设备打开Pages，实测默认AI、新闻正文、帖子补读、批量补读进度、完成提醒和资料库保存。对当日新事件/新帖子核对后台能定位同一ID；后台公开资料快照如何随GitHub日更刷新仍需在实际部署时接通验收，不能将前端数据更新误当成后台文件已更新。

## 平台Environment填写

```dotenv
WEB_LLM_API_URL=
WEB_LLM_API_KEY=
WEB_LLM_MODEL=
WEB_LLM_FALLBACK_URL=
WEB_LLM_DAILY_BUDGET=5
WEB_LLM_ORIGIN=https://rhzhang1007-sys.github.io
WEB_LLM_SERVICE_ORIGIN=
WEB_LLM_LISTEN_HOST=0.0.0.0
```

API URL、Key、模型沿用原配置，由用户在平台私下填写，不改服务商与模型。备用URL只填写已授权的服务商节点。WEB_LLM_SERVICE_ORIGIN填平台给出的后台完整HTTPS来源地址，不带/api或路径。WEB_LLM_ORIGIN填Pages的协议和域名，不带/Fundproject/路径。

已核对且未过期的模型价格可沿用项目价格表；若使用表外模型，需同时配置WEB_LLM_PRICE_IN与WEB_LLM_PRICE_OUT，否则共用AI保持不可用。每日预算为程序估算额度，持久账本需保留，实际费用以服务商为准。

## 前端只填后台地址

修改prototype/dist/deployment-config.mjs：

```javascript
export const API_ORIGIN='https://你的后台实际域名';
```

这不是模型API地址，也不包含Key。用户只需打开Pages产品链接，不需要知道后台地址或配置模型。若网页与后台部署于同一个站点，则API_ORIGIN保持空值，后台两个origin可使用同一个站点来源。

## 已验收和未验收

本地全量192项JavaScript测试通过。两个端口模拟Pages与独立后台：默认AI可用、跨来源POST和预检通过、整组补读完成并轮询取回正文/评论、AI分析完成提醒及自动保存通过，控制台错误0。全部用模拟来源/模型，付费模型调用0。

本机没有Docker，因此尚未构建容器镜像，也没有真实云端部署或互联网TLS/连接稳定性验收。Pages发布包精简、远端数据全路径覆盖、后台资料随日更新仍需完成。当前代码未推送、不启用发布，不把配置存在说成网站已上线。

## 官方依据

- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://render.com/docs/docker
- https://render.com/docs/web-services
- https://render.com/docs/disks
- https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/App-Publishing/Cloud-Services
