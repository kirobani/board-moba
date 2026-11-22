# 棋盘 MOBA · Board MOBA

让程序控制五位选手和一名教练，在六角棋盘上打一局回合制 MOBA。比赛使用同时结算。核心选手先提出指令，队友参考它的选择，教练最后可以覆盖一条指令。

## 本地试玩

需要 Python 3.10+ 和 Node.js 24。安装 Python 依赖并在仓库根目录运行：

```sh
python -m pip install -r requirements.txt
python app/server.py
```

打开浏览器访问 [本地大厅](http://127.0.0.1:18860/)。大厅可选择人类或示例队控制蓝红方。杯赛支持抽签、三胜晋级瑞士轮、BO5 单败淘汰、焦点桌与赛后数据。新建杯赛使用仓库里的 16 套示例阵容。杯赛页也附有两届已经公开揭晓的正式赛事和逐局回放。运行数据写入 `.local/`。

## 赛题与基准

- [中文赛题](challenge/zh/赛题.md) · [中文参赛提示词](challenge/zh/PROMPT_AGENT.txt) · [完整规则](challenge/zh/完整规则.txt) · [API](challenge/zh/API.txt)
- [English challenge](challenge/en/CHALLENGE.md) · [English entrant prompt](challenge/en/PROMPT_AGENT.txt) · [Full rules](challenge/en/RULES.txt)
- 常规基准为 [Standard 10](referee/agents/standard-10.cjs)，高压基准为 [Opus](referee/agents/opus.cjs)。[基准清单](referee/active-benchmark.json)记录引擎、配置和策略的 SHA-256。

原参赛包保留当时的 180 分钟开发及 210 分钟收卷流程和裁判客户端。公开版本可以离线评测，项目运行不依赖模型 API。

```sh
node examples/squads.cjs demo-01 .local/demo-01.json
node referee/challenge.cjs .local/demo-01.json .local/benchmark-demo-01 1
```

最后一个参数是每档基准的种子数量，每个种子换边各打一次。改成 `10` 即每档 20 局。输出目录须为新目录。自行写好五个位置、教练模块和 `roster.json` 后，可运行 `node challenge/pack-team.cjs 队伍目录 .local/submission.json` 打包，再交给同一个裁判。评测自己的代码请在本机或隔离环境运行；本地服务只监听回环地址。

## 正式成绩

- [16 队基准成绩与开发用时](results/基准成绩与开发用时.md)，表内可点到每队 40 局的裁判结果。
- [16 队互打结果](results/互打结果.md) · [1,200 局 CSV](results/round-robin.csv) · [交手矩阵](results/head-to-head.json) · [选手名单与成绩 JSON](results/teams.json)。
- [已揭晓杯赛存档](archives/cups)含赛程、比分、回放及原核验摘要。正式选手提交源码由原比赛留档管理。示例队的赛果与正式成绩分开记账。

源代码使用 [MIT 许可证](LICENSE)。战队和模型名用于识别成绩来源。
