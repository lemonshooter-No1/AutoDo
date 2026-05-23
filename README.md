# AutoDo

**AI 发布，推送任务。** 雇主：发布 → 等完成 → 付款。雇员：听单 → 接单 → 交付 → 拿钱。**无浏览、无聊天。**

## 文档

- [MVP 需求（六步闭环）](docs/PROJECT_REQUIREMENTS.md)
- [**两人协作开发指南**](docs/COLLABORATION.md) ← 和队友一起看

## 和队友一起开发（简要）

1. 本机初始化 Git 并推到 GitHub/Gitee（见 [协作指南](docs/COLLABORATION.md)）
2. 邀请对方为 Collaborator，或让对方 `git clone` 你的仓库
3. 队友：`npm run install:backend` → `npm start` → 打开 http://127.0.0.1:8000
4. 用分支 + Pull Request 合并，开发前先 `git pull`

## 快速跑通

在 PowerShell 里**只输入命令本身**，不要粘贴带 `PS C:\...>` 或报错堆栈的整段内容。

```powershell
cd C:\AutoDo
npm run install:backend
npm start
```

（也可在 `backend` 目录下执行：`cd backend` 后 `npm install` / `npm start`）

看到 `AutoDo  http://127.0.0.1:8000  （前端 + API）` 后，浏览器打开：

**http://127.0.0.1:8000**

- **雇主**：输入需求 → 补充 AI 追问 → 确认付款 → 看进度  
- **雇员**：开始听单 → 收推送接单 → 提交交付  

也可用命令行演示（另开终端）：

```powershell
cd C:\AutoDo
npm run demo
```

### 端口被占用（EADDRINUSE）

```powershell
cd C:\AutoDo\backend
npm run stop      # 释放 8000
npm start
```

或换端口：

```powershell
npm run start:8001
$env:PORT="8001"; npm run demo
```

演示脚本会走完整链路：解析 → 澄清 → 托管 → 派单 → 接单 → 验货放款。

## API 摘要

| 步骤 | 方法 | 路径 |
|------|------|------|
| ①② 发布 | POST | `/tasks` |
| ② 澄清 | POST | `/tasks/{id}/clarify` |
| ③ 托管+派单 | POST | `/tasks/{id}/confirm-payment` |
| ④⑤ 听单 | GET | `/workers/{id}/inbox` |
| ⑤ 接单 | POST | `/workers/{id}/tasks/{id}/accept` |
| ⑥ 提交+结算 | POST | `/workers/{id}/tasks/{id}/submit` |

## 目录

```
backend/src/      # Express API（六步闭环）
backend/scripts/demo_flow.js
docs/             # 精简 PRD
backend/app/      # Python 草案（需 3.10+，可选）
```
