# 3.0 模块边界与维护约定

## 源码、产物和版本

`src/index.js` 是唯一浏览器启动入口。`scripts/build.mjs` 从 package.json 读取版本，先生成独立页面世界 bundle，再生成一个 IIFE 用户脚本。`src/userscript.meta.txt` 管理权限及安装元数据；版本占位由构建替换。根目录 `bugdone-multica.user.js` 是生成产物，不能手工维护第二份逻辑。

`src/core/index.js` 是纯逻辑公共出口。站点配置、匹配、归一化、草稿、查重及偏好按职责分文件，使用标准 import/export。核心模块导入时不读浏览器存储或发请求；HTML 清理等浏览器能力只在函数被调用时使用。

## 会话与 UI

`src/app.js` 保留现有单一会话：config、当前来源、任务草稿、附件、捕获 epoch 和状态缓存。`createMount(session)` 读取的 session 是 getter/setter 接口，不是这些值的副本。事件执行时读取最新值；不要在挂载模块顶层解构 config、附件数组或当前来源后长期持有快照。

模板和样式分别在 `src/ui/panel.html`、`src/ui/styles.css`。`createPanelMarkup(version)` 只替换版本占位，不执行模板中的任意代码。未来可继续按设置、站点配置等 Tab 拆绑定；本次不同时引入状态库或重写交互。

## 环境与服务

- `createStorage()` 显式接收 GM API 和浏览器环境，保持 GM、原生存储、localStorage、sessionStorage、内存的回退顺序；mode/failed 是实时 getter。
- `createNetwork()` 保持 GM、Fastlane 原生网络桥、fetch 的通道顺序，通过回调通知连接状态。
- `createAttachments()` 管理现有压缩及上传流程，通过 message/gmCall 等依赖接入当前会话。
- 应用始终显式传递沙箱中的 GM API，避免假设它们一定是 window 的属性。

不修改 namespace、存储前缀、站点 ID、查重键、接口字段或附件上传顺序。

## 页面世界边界

跨油猴沙箱与页面世界的监听需要完整独立的词法作用域。`src/platform/page-world.js` 单独构建为文本，由 `page-injection.js` 携带 profile/channel 参数注入；它不依赖主 bundle 中可能重命名的函数。不再使用 Function.toString 拼装跨模块依赖。

注入仍沿用既有通道、来源校验、epoch 失效及停止机制；暂停不阻止原网页自身发请求，只停止桥接捕获。

## 测试与兼容适配

原有 141 个行为场景保留。核心测试使用实际核心 bundle 导出，额外测试直接 import 原始 ES 模块工厂；构建测试执行实际页面 bundle。

旧运行时片段测试暂由 `test/helpers/source.cjs` 读取当前模块并还原片段视图。它不包含冻结的旧产品源码，也不参与正式构建。未来增加测试优先直接调用模块接口；按 Tab 继续拆分绑定时逐步替换这些适配测试。

实际生成产物另在 Ego Lite 使用合成配置/响应验证。没有对真实 Multica 创建任务，也没有下载用户私有图片。

## 开发监听与交付

轮询仅扫描 src/ 与 package.json，每 750ms 检查修改；不监听生成目录，因此不会自循环。每次重建正式产物，开发模式另外生成忽略目录内的 source map。正式产物没有 sourceMappingURL 或绝对本机路径。

写文件通过临时文件 + rename 原子替换，内容相同则不重写。`npm run check` 比较当前产物与重新计算结果；重复构建必须字节一致。`npm run test:watch` 会临时修改一处常量并恢复，不可和其他构建/测试并行。
