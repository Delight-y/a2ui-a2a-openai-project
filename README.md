# A2UI + A2A + OpenAI 项目

一个演示 **A2UI（Agent-to-UI）** 和 **A2A（Agent-to-Agent）** 协议集成的完整示例项目。该项目展示了如何通过多个Agent协作，调用OpenAI API获取智能结果，并使用A2UI协议实时更新前端UI。

## 📋 目录

- [项目介绍](#项目介绍)
- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [环境配置](#环境配置)
- [运行说明](#运行说明)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [相关文档](#相关文档)

## 🎯 项目介绍

本项目是一个完整的Agent协作系统演示，包含：

- **Main-Agent（主代理）**: 协调用户交互，管理UI状态，调用子Agent
- **Weather-Agent（天气代理）**: 专门处理天气查询，调用OpenAI API
- **Flight-Agent（机票代理）**: 专门处理机票查询，调用OpenAI API
- **前端界面**: 基于A2UI协议的实时UI渲染器

系统通过 **A2A协议** 实现Agent间的发现和通信，通过 **A2UI协议** 实现前后端的UI同步更新。

## ✨ 核心特性

- 🔄 **A2A协议**: Agent间通过标准化的Agent Card发现和sendSubscribe接口通信
- 🎨 **A2UI协议**: 采用v0.8-like格式，支持组件目录、数据模型和增量更新
- ⚡ **实时更新**: 基于SSE（Server-Sent Events）实现服务器到客户端的实时通信
- 🤖 **多Agent协作**: Main-Agent并行调用多个子Agent，聚合结果
- 🧠 **OpenAI集成**: 子Agent调用OpenAI API获取智能响应
- 📦 **模块化设计**: 每个Agent独立运行，易于扩展和维护

## 🏗️ 系统架构

```
用户浏览器 (前端)
    ↓ (SSE连接 - A2UI协议)
Main-Agent (主代理服务器)
    ↓ (HTTP请求 - A2A协议)
子Agent (Weather-Agent / Flight-Agent)
    ↓ (HTTP API)
OpenAI API
    ↓ (返回结果)
子Agent → Main-Agent → A2UI生成 → 前端渲染 → 用户
```

### 数据流

1. **用户交互**: 用户在前端输入查询需求并提交
2. **Main-Agent处理**: 接收用户动作，显示加载状态
3. **A2A调用**: Main-Agent并行调用Weather-Agent和Flight-Agent
4. **Agent发现**: 通过 `.well-known/agent-card.json` 发现Agent能力
5. **子Agent处理**: 子Agent调用OpenAI API获取智能结果
6. **结果聚合**: Main-Agent聚合两个Agent的结果
7. **A2UI更新**: 生成A2UI格式的数据模型更新
8. **前端渲染**: 前端接收SSE消息，更新UI显示结果

## 🚀 快速开始

### 前置要求

- Node.js >= 16.0.0
- npm 或 yarn
- OpenAI API Key（或兼容的API服务）

### 安装依赖

```bash
npm install
```

### 配置环境变量

创建 `.env` 文件（或设置环境变量）：

```bash
# Main-Agent端口（默认3000）
MAIN_PORT=3000

# Weather-Agent端口（默认3001）
WEATHER_PORT=3001
WEATHER_AGENT_URL=http://localhost:3001

# Flight-Agent端口（默认3002）
FLIGHT_PORT=3002
FLIGHT_AGENT_URL=http://localhost:3002

# OpenAI配置
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 启动服务

**方式1: 分别启动（推荐用于开发）**

打开三个终端窗口：

```bash
# 终端1: 启动Main-Agent
cd main-agent
node server.js

# 终端2: 启动Weather-Agent
cd weather-agent
node server.js

# 终端3: 启动Flight-Agent
cd flight-agent
node server.js
```

**方式2: 使用进程管理器（推荐用于生产）**

可以使用 `pm2`、`forever` 或 `nodemon` 等工具管理多个进程。

### 访问应用

打开浏览器访问：`http://localhost:3000`

## ⚙️ 环境配置

### 必需的环境变量

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `OPENAI_API_KEY` | OpenAI API密钥 | - | ✅ |
| `OPENAI_BASE_URL` | OpenAI API基础URL | `https://api.openai.com/v1` | ❌ |
| `MAIN_PORT` | Main-Agent端口 | `3000` | ❌ |
| `WEATHER_PORT` | Weather-Agent端口 | `3001` | ❌ |
| `FLIGHT_PORT` | Flight-Agent端口 | `3002` | ❌ |
| `WEATHER_AGENT_URL` | Weather-Agent URL | `http://localhost:3001` | ❌ |
| `FLIGHT_AGENT_URL` | Flight-Agent URL | `http://localhost:3002` | ❌ |

### 使用兼容的OpenAI API服务

如果使用兼容OpenAI API格式的其他服务（如本地部署的模型服务），只需修改：

```bash
OPENAI_BASE_URL=http://your-api-server/v1
OPENAI_API_KEY=your_api_key
```

## 📖 运行说明

### 1. 启动所有服务

确保三个Agent服务都已启动：

- Main-Agent: `http://localhost:3000`
- Weather-Agent: `http://localhost:3001`
- Flight-Agent: `http://localhost:3002`

### 2. 访问前端

在浏览器中打开 `http://localhost:3000`，你会看到：

- 标题："A2A + A2UI(v0.8-like) Demo"
- 输入框：用于输入查询需求
- 提交按钮
- 天气卡片（初始显示"（等待查询）"）
- 机票卡片（初始显示"（等待查询）"）

### 3. 使用示例

在输入框中输入查询，例如：

```
查询北京明天的天气和到上海的机票
```

点击"提交"按钮后：

1. UI会显示"查询中..."状态
2. Main-Agent并行调用Weather-Agent和Flight-Agent
3. 子Agent调用OpenAI API获取结果
4. 结果聚合后通过A2UI协议更新前端
5. 天气卡片显示温度信息
6. 机票卡片显示格式化的机票选项列表

### 4. 健康检查

可以访问以下端点检查服务状态：

- Main-Agent: `http://localhost:3000/health`
- Weather-Agent: `http://localhost:3001/health`
- Flight-Agent: `http://localhost:3002/health`

## 📁 项目结构

```
a2ui-a2a-openai-project/
├── main-agent/              # Main-Agent服务
│   ├── server.js            # Main-Agent服务器（处理A2UI和A2A协议）
│   └── web/                 # 前端文件
│       ├── index.html       # HTML页面
│       └── app.js           # A2UI渲染器（前端JavaScript）
├── weather-agent/           # Weather-Agent服务
│   └── server.js            # 天气子Agent服务器
├── flight-agent/            # Flight-Agent服务
│   └── server.js            # 机票子Agent服务器
├── package.json             # 项目依赖配置
├── .env                     # 环境变量配置（需要创建）
├── .gitignore              # Git忽略文件
├── README.md               # 本文件
└── 系统架构流程文档.md      # 详细的技术流程文档
```

## 🛠️ 技术栈

### 后端

- **Node.js**: JavaScript运行时
- **Express**: Web框架
- **OpenAI SDK**: OpenAI API客户端
- **dotenv**: 环境变量管理

### 前端

- **原生JavaScript (ES6+)**: 无框架依赖
- **EventSource API**: SSE客户端实现
- **DOM API**: UI渲染

### 协议

- **A2UI v0.8-like**: Agent-to-UI协议
  - Component Catalog（组件目录）
  - Data Model（数据模型）
  - Incremental Updates（增量更新）

- **A2A**: Agent-to-Agent协议
  - Agent Card Discovery（Agent发现）
  - sendSubscribe接口（订阅接口）
  - SSE流式传输

- **SSE**: Server-Sent Events（服务器推送事件）

## 📚 相关文档

### 详细技术文档

查看 [`系统架构流程文档.md`](./系统架构流程文档.md) 了解：

- 完整的系统流程说明（10个阶段）
- 每个阶段的详细执行时机
- 代码行号引用和函数说明
- SSE消息格式和数据流图
- 关键技术点解析

### API端点

#### Main-Agent

- `GET /`: 前端页面
- `GET /ui/stream?surfaceId=main`: SSE UI流（A2UI协议）
- `POST /ui/event`: 用户动作处理
- `GET /health`: 健康检查

#### Weather-Agent / Flight-Agent

- `GET /.well-known/agent-card.json`: Agent Card（A2A协议）
- `POST /tasks/sendSubscribe`: 订阅接口（A2A协议，SSE流）
- `GET /health`: 健康检查

### A2UI协议格式

#### Component Catalog

```json
{
  "surfaceUpdate": {
    "surfaceId": "main",
    "components": [
      {
        "id": "root",
        "component": {
          "Column": {
            "children": {
              "explicitList": ["title", "input", "submitBtn", "resultArea"]
            }
          }
        }
      }
    ]
  }
}
```

#### Data Model Update

```json
{
  "dataModelUpdate": {
    "surfaceId": "main",
    "path": "/weather",
    "contents": [
      { "key": "temp_text", "valueString": "5 ~ 15 °C" }
    ]
  }
}
```

### A2A协议格式

#### Agent Card

```json
{
  "name": "weather-agent",
  "version": "0.0.1",
  "endpoints": {
    "sendSubscribe": "http://localhost:3001/tasks/sendSubscribe"
  }
}
```

#### sendSubscribe请求

```json
{
  "input": {
    "query": "查询北京明天的天气"
  }
}
```

#### sendSubscribe响应（SSE流）

```
data: {"type":"status","taskId":"w_1234567890","stage":"started"}

data: {"type":"final","taskId":"w_1234567890","artifact":{"kind":"weather","data":{...}}}

```

## 🔧 开发说明

### 添加新的子Agent

1. 创建新的Agent目录（如 `hotel-agent/`）
2. 实现Agent Card端点：`GET /.well-known/agent-card.json`
3. 实现sendSubscribe端点：`POST /tasks/sendSubscribe`
4. 在Main-Agent中配置Agent URL
5. 在Main-Agent中调用新的Agent

### 扩展UI组件

1. 在Main-Agent的 `sendInitialUI()` 中添加组件定义
2. 在前端的 `buildElement()` 中添加组件渲染逻辑
3. 更新数据模型绑定

### 调试技巧

- 查看浏览器控制台：前端日志和错误
- 查看服务器控制台：后端日志和错误
- 使用网络面板：查看SSE消息和HTTP请求
- 检查健康检查端点：确认服务运行状态

## 📝 许可证

ISC

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📧 联系方式

如有问题或建议，请通过Issue反馈。

---

**注意**: 本项目为演示项目，生产环境使用前请进行充分的安全性和性能测试。
