# Source Evaluation

评估日期：2026-07-18。这里只记录与当前 32 项指标有关的事实；价格、额度和许可可能变化，实施前必须再次核对。

## 结论

| 来源 | 认证/费用 | Render 与技术适配 | 结论 |
| --- | --- | --- | --- |
| FRED | API v2 需要免费 Key；现有 CSV 图表端点当前无需 Key | HTTP/CSV，可直接用 Node；历史长、日频稳定 | P1 首选。宏观与美股指数存在发布延迟，不是实时行情 |
| U.S. Treasury | 无 Key | 官方 XML/页面，Node 已实现 | P1 首选 US2Y/10Y/30Y |
| ECB SDMX | 无 Key | 官方 HTTPS，CSV/JSON/SDMX；历史日频自 1999 | EURUSD 交叉验证首选 |
| AKShare | 免费开源 Python 库；数据多来自公开网页；文档提示以学术研究为主 | 需要 Python 或自建 AKTools；上游网页变化会破坏接口 | B 级，仅中国市场 adapter/核验，不作为唯一真相源 |
| yfinance | 免费开源 Python 库；Yahoo 数据声明仅供个人使用 | 需要 Python；非官方 Yahoo 接口、限流与字段变化不可控 | B 级备用。上线前复核个人项目展示许可 |
| pandas-datareader | 免费 Python 包，本身不是数据供应商 | 需要 Python；可读 FRED 等宏观源 | 当前 Node 项目无必要引入，优先直接 HTTP |
| Fuyao AI Cubes | 需要 `X-api-key`；文档未公开稳定免费额度 | REST 可直接由 Node 调用，A 股/指数结构化良好 | CSI300 候选 B；先确认免费额度、数据许可与服务 SLA |
| Tushare | Token；积分门槛，基础日线 120 积分起，更多接口需付费/单独授权 | HTTP/Python 均可；服务器调用可行 | 中国市场备用，非“全免费”；不作为 Batch 1 依赖 |
| Alpha Vantage | 免费 Key，免费层当前 25 请求/日 | REST/JSON/CSV，Node 适配简单 | 黄金/白银与 FX 备用；按日批处理可行，不能高频轮询 |
| CCXT | 开源，多语言；公共行情是否免 Key取决于交易所 | Node 原生支持，内置限速 | 当前 32 项没有加密资产，不应引入 |
| Nasdaq Data Link | 免费与付费数据集并存；免费账号/API Key；配额按产品 | REST/SDK，Node 可直接 HTTP | 仅当所需数据集许可和价格明确时采用，不作为 P1 |
| ChinaBond/CCDC | 官方公开页面；未确认稳定公开 API | 当前为 HTML 解析，Render 可运行但页面结构脆弱 | B 级，保留并增加契约测试/失败保留旧值 |
| CFFEX | 官方日统计和历史下载可公开查看；完整历史产品另有申请 | 页面/下载解析需主力合约选择规则 | B 级，先定义主力连续规则再自动化 |
| BLS | v1 无 Key 25 请求/日；v2 注册后 500 请求/日 | 官方 JSON API，Node 适配简单 | 非农/CPI 实际值 A；市场预期不由 BLS 提供 |

## 官方依据

- [FRED API v2 与 API Key](https://fred.stlouisfed.org/docs/api/fred/v2/)
- [AKShare 项目说明与风险提示](https://akshare.akfamily.xyz/introduction.html)
- [yfinance 官方仓库及个人用途说明](https://github.com/ranaroussi/yfinance)
- [pandas-datareader 维护中的来源](https://pydata.github.io/pandas-datareader/stable/remote_data.html)
- [Fuyao AI Cubes 项目介绍](https://fuyao.aicubes.cn/docs/introduction/)
- [Tushare 积分与频次](https://tushare.pro/document/1?doc_id=290)
- [Alpha Vantage 免费配额](https://www.alphavantage.co/support/)
- [Alpha Vantage API 文档](https://www.alphavantage.co/documentation/)
- [CCXT Manual](https://github.com/ccxt/ccxt/wiki/manual)
- [Nasdaq Data Link Getting Started](https://docs.data.nasdaq.com/v1.0/docs/getting-started)
- [ECB SDMX Web Service](https://data.ecb.europa.eu/help/getting-data-web-services-sdmx-0)
- [BLS API 限额](https://www.bls.gov/developers/api_faqs.htm)
- [CFFEX 历史数据服务](https://www.cffex.com.cn/lssjfw/)

## 许可与稳定性规则

1. 开源库许可不等于底层数据可自由再分发；必须分别核对 Yahoo、交易所、指数公司和商业数据集条款。
2. 网页解析一律评为 B，不因为当前能返回数据而升级为 A。
3. 需要付费或授权的口径（FR007 IRS、MOVE、中国信用利差）继续 C，不用不明抓取源替代。
4. 个人项目仍是公开服务器自动调用；供应商若仅允许本地个人分析，不能直接用于公开页面。
5. 不在本阶段申请或保存任何 API Key。
