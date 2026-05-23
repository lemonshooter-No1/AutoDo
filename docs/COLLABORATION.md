# 两人协作开发指南

## 一、你需要做的（项目主人）

### 1. 初始化 Git 并推送到 GitHub

在项目根目录 `C:\AutoDo` 打开 PowerShell：

```powershell
cd C:\AutoDo
git init
git add .
git commit -m "Initial commit: AutoDo MVP backend + frontend"
```

在 [GitHub](https://github.com/new) 新建仓库（例如 `AutoDo`），**不要**勾选 README（本地已有）。

```powershell
git branch -M main
git remote add origin https://github.com/你的用户名/AutoDo.git
git push -u origin main
```

国内可用 [Gitee](https://gitee.com/)，命令相同，把 URL 换成 Gitee 地址即可。

### 2. 邀请队友

- **GitHub**：仓库 → Settings → Collaborators → Add people（对方 GitHub 账号）
- **Gitee**：仓库 → 管理 → 仓库成员 → 添加

或让对方 **Fork** 后提 Pull Request（适合开源式协作）。

---

## 二、队友需要做的（克隆与运行）

### 1. 克隆代码

```powershell
git clone https://github.com/你的用户名/AutoDo.git
cd AutoDo
```

### 2. 环境要求

- [Node.js](https://nodejs.org/) 18+（你本机 v22 即可）
- 无需 Python（除非要改 `backend/app/` 里的旧草案）

### 3. 安装并启动

```powershell
npm run install:backend
npm start
```

浏览器打开：**http://127.0.0.1:8000**

另开终端跑端到端演示：

```powershell
npm run demo
```

端口占用时：

```powershell
npm run stop
npm start
```

---

## 三、日常协作流程（推荐）

### 分支策略（两人够用）

| 分支 | 用途 |
|------|------|
| `main` | 可随时运行的稳定版 |
| `dev` | 日常合并开发（可选） |
| `feature/xxx` | 各自功能分支 |

示例：

```powershell
git checkout -b feature/employer-ui
# 开发、提交
git add .
git commit -m "feat: 优化雇主发布页"
git push -u origin feature/employer-ui
```

在 GitHub/Gitee 上开 **Pull Request** 合并到 `main`，对方 Review 后再合。

### 开工前 / 收工后

```powershell
git pull origin main          # 拉最新代码
# ... 开发 ...
git add .
git commit -m "描述做了什么"
git push
```

有冲突时：先 `git pull`，解决冲突文件后再 `commit` + `push`。

---

## 四、建议分工（可按兴趣改）

| 模块 | 目录 | 说明 |
|------|------|------|
| 后端 API / 状态机 | `backend/src/` | `index.js`、`ai.js`、`dispatch.js` |
| 前端 | `backend/public/` | `index.html`、`app.css`、`app.js` |
| 需求与接口契约 | `docs/` | `PROJECT_REQUIREMENTS.md` |

约定：

- 改 API 路径或 JSON 字段前，在群里说一声或更新 `docs/`
- 不要提交 `backend/data/`（已在 `.gitignore`）
- 密钥放 `.env`，只提交 `.env.example`

---

## 五、可选：实时联调

- **VS Code / Cursor Live Share**：同屏改代码  
- **ngrok / localtunnel**：把本机 `8000` 暴露给队友访问（演示用）  
- 统一用 `main` 上的 `npm run demo` 作为「冒烟测试」

---

## 六、提交信息习惯（简短即可）

```
feat: 新增雇员定位上报
fix: 修复澄清后无法付款
docs: 更新 PRD
style: 前端浅色样式调整
```

---

## 七、仓库结构速览

```
AutoDo/
├── README.md              # 快速开始
├── package.json           # 根目录脚本（start / demo）
├── docs/
│   ├── PROJECT_REQUIREMENTS.md
│   └── COLLABORATION.md   # 本文件
└── backend/
    ├── src/               # Express API
    ├── public/            # 静态前端
    ├── scripts/           # demo_flow.js
    └── package.json
```

有问题先 `npm run demo` 确认六步闭环是否正常，再在 Issue 或群里描述现象。
