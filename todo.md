## 高优先级

1. 还不能真正通过 windowId 打开子窗口

当前 src/electron/src/main.ts:10 只创建主窗口，并且固定读取：

getRendererConfig('main')

还缺少：

- WindowManager
- ipcMain.handle('window:open')
- preload 的 openWindow(windowId)
- 窗口实例缓存和关闭管理

因此现在虽然有 window-a 配置，但 Electron 还不会使用它。

2. 远程 URL 加载失败时不会使用 fallback

当前逻辑是：

if (renderer?.url) {
void window.loadURL(renderer.url)
} else {
void window.loadFile(...)
}

只要配置了 URL，就不会再尝试 fallback。网络不可用或服务器错误时会显示加载失败页面。

建议改为：

try {
if (!renderer?.url) throw new Error('No remote URL')
await window.loadURL(renderer.url)
} catch {
await window.loadFile(
resolve(app.getAppPath(), renderer.fallback),
)
}

3. 开发配置被永久缓存

src/electron/src/renderer-config.ts:14 第一次读取后会一直缓存：

rendererConfig ??= loadRendererConfig()

但 dev.mjs 会持续更新 .dev/renderers.json 中的 running。主进程无法看到后续变化。

可以选择：

- 每次调用重新读取配置
- 监听配置文件变化并更新缓存
- 删除 running 字段，因为窗口 URL 本身是固定的
- 通过进程间通信直接查询开发管理器状态

如果后续需要“点击按钮时自动启动未运行的 renderer”，仅靠 JSON 文件不够。

4. 开发管理器与 Electron 尚未通信

当前只能在终端输入：

start window-a

如果用户在主窗口点击“打开 window-a”，Electron 无法通知 dev.mjs 启动对应 Vite 服务。

后续可以给 dev.mjs 增加仅监听本机的控制服务：

POST /windows/window-a/start
DELETE /windows/window-a
GET /windows

Electron 开发环境打开窗口时：

请求启动 window-a
→ 等待 5174 可访问
→ 创建 BrowserWindow

## 中优先级

5. running 表示“进程已创建”，不表示“服务已就绪”

scripts/dev.mjs:115 在调用 spawn() 后立即标记运行：

state.process = child

此时 Vite 可能仍在启动，甚至可能因为端口冲突而退出。

建议增加状态：

stopped
starting
running
failed

只有 wait-on tcp:<port> 成功后才标记为 running。

6. 端口并不完全稳定

当前端口根据目录排序位置计算：

port: 5173 + index

如果增加一个排序位置更靠前的项目，后续项目端口可能变化。

更稳定的做法是在项目中声明：

{
"emw": {
"windowId": "window-a",
"devPort": 5174
}
}

或者维护一份开发注册表。这样项目重命名、增删都不会影响其他窗口端口。

7. 配置文件缺少运行时校验

当前直接断言 JSON 类型：

JSON.parse(...) as RendererConfig

以下情况会让主进程直接崩溃：

- 配置文件不存在
- JSON 格式错误
- 缺少 fallback
- url 类型错误
- 找不到 windowId

建议读取配置时校验，并输出包含配置路径和 windowId 的明确错误。

8. Electron 源码没有 TypeScript 类型检查

Electron 目前只经过 esbuild。esbuild 会转换 TypeScript，但不会做完整类型检查。

建议给 src/electron 添加 tsconfig.json：

{
"compilerOptions": {
"target": "ESNext",
"module": "NodeNext",
"moduleResolution": "NodeNext",
"noEmit": true,
"strict": true,
"types": ["node"]
},
"include": ["src"]
}

然后：

{
"scripts": {
"typecheck": "tsc",
"build": "npm run typecheck && node esbuild.config.mjs"
}
}

9. 构建脚本的项目筛选不一致

dev.mjs 和 install-all.mjs 会检查 package.json，但 scripts/build-windows.mjs:10 会把所有一级目录都当成项目。

如果以后加入说明目录、共享资源目录，构建会失败。建议统一使用同一套项目发现函数。

## 较低优先级

10. clean-all.mjs 依赖当前工作目录

其他脚本都通过 import.meta.url 找根目录，但 clean-all.mjs 使用相对路径。通过根 npm script 执行没问题，直接从其他目录调用会失败。

11. 开发进程错误处理可以加强

dev.mjs 还缺少：

- 子进程 error 事件处理
- Electron/esbuild 意外退出后的明确状态
- tree-kill 失败处理
- 端口占用时显示占用项目
- Electron 进程的 restart 命令

12. 尚未配置真正的桌面应用打包

目前 dist 可以通过：

electron dist

运行，但还不能生成 .exe、.app 或安装包。后续仍需要 Electron Forge、electron-builder 或 Electron Packager，并配置：

- appId
- 应用名称
- 图标
- asar
- 输出目录
- Windows/macOS/Linux 打包目标

## 当前做得比较好的部分

- src/windows/\* 可以完全独立安装和开发。
- 根项目与 src/electron 使用 workspace，边界合理。
- main/preload 与 renderer 构建彼此独立。
- Vite 使用 base: './'，本地加载资源正常。
- nodeIntegration: false
- contextIsolation: true
- sandbox: true
- webSecurity: true
- 开发和生产 renderer 配置结构统一。
- dist/package.json 的入口正确。
- npm run build 当前全量通过。
