# API 参考

## 通用约定

- Base URL 与部署环境一致，代码不硬编码域名。
- JSON 响应使用 UTF-8。
- `id` 在 API 中转换为 JavaScript Number。
- 写入使用参数化 SQL；唯一代码冲突返回 `409`。
- 未知 `/api/*` 路径返回 `404 {"error":"接口不存在"}`。
- 当前 API 未实现认证，部署边界和写接口保护属于后续安全工作。

## 接口总览

| Method | Path | 参数 | 成功返回 | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 无 | 200/503 object | 应用、环境和数据库健康状态 |
| GET | `/api/dashboard` | 无 | 200 object | 聚合指标和宏观事件，标准 JSON 返回 |
| GET | `/api/dashboard-compat` | 可选缓存参数 `t` | 200 object | 浏览器正式加载接口，一次性 Buffer 返回 |
| GET | `/api/indicators` | 无 | 200 array | 全部指标 |
| POST | `/api/indicators` | JSON body | 201 indicator | 新增手工指标 |
| PUT | `/api/indicators/:id` | path ID + JSON body | 200 indicator | 编辑指标并标记为手工维护 |
| GET | `/api/events` | 无 | 200 array | 全部宏观事件 |
| POST | `/api/events` | JSON body | 201 event | 新增宏观事件 |
| POST | `/api/refresh` | 无 | 200/207 object | 刷新公开数据源并写入数据库 |

## GET `/api/health`

正常：

```json
{"status":"ok","environment":"staging","database":"connected"}
```

数据库不可用时返回 503：

```json
{"status":"error","environment":"staging","database":"disconnected"}
```

`environment` 来自 `APP_ENV`，不返回连接信息。

## GET `/api/dashboard` 与 `/api/dashboard-compat`

两者数据结构相同：

```json
{
  "indicators": [{"id":1,"symbol":"CN10Y","name":"中国国债 10Y"}],
  "events": [{"id":1,"event_time":"2026-07-13T09:30","region":"中国"}]
}
```

`dashboard-compat` 是当前浏览器入口：服务端先完整序列化并缓冲响应，再一次性结束响应，以规避已发现的浏览器响应正文兼容问题。查询参数 `t` 仅用于绕过缓存，不参与业务查询。

## GET `/api/indicators`

按 `category, sort_order, name` 排序返回指标数组。完整字段见 [数据字典](03-DATA_DICTIONARY.md)。

## POST `/api/indicators`

请求示例：

```json
{
  "symbol":"IRS5Y",
  "name":"FR007 IRS 5Y",
  "category":"利率",
  "value":1.75,
  "previous_value":1.73,
  "value_unit":"%",
  "change_type":"bp",
  "source":"Wind 手工",
  "as_of":"2026-07-13",
  "frequency":"Daily Close",
  "is_featured":true,
  "sort_order":4
}
```

必填：`symbol`、`name`、`category`、`value`、`previous_value`、`source`、`as_of`、`frequency`、`change_type`。`change_type` 只能为 `bp` 或 `percent`。成功返回完整指标，且 `is_manual=true`。

## PUT `/api/indicators/:id`

请求字段与新增相同。成功返回更新后的完整指标；不存在返回 404；代码唯一冲突返回 409。该操作始终将 `is_manual` 设为 `true`。

## GET `/api/events`

按 `event_time` 排序返回宏观事件数组。字段见 [数据字典](03-DATA_DICTIONARY.md)。

## POST `/api/events`

```json
{
  "event_time":"2026-07-13T09:30",
  "region":"中国",
  "name":"CPI 同比",
  "importance":3,
  "previous":"0.1%",
  "forecast":"0.2%",
  "actual":"",
  "source":"手工录入"
}
```

`event_time`、`region`、`name`、`source` 必填；`importance` 默认 3，数据库约束为 1–5。

## POST `/api/refresh`

调用 U.S. Treasury、ChinaBond 与 FRED 等公开来源，所有数据库写入均等待完成。全部成功返回 200，部分失败返回 207：

```json
{
  "results":[
    {"symbol":"US10Y","status":"updated","as_of":"2026-07-11"},
    {"symbol":"ChinaBond","status":"error","error":"..."}
  ],
  "refreshed_at":"2026-07-13T00:00:00.000Z"
}
```

## 历史临时接口

`/api/ping-text` 曾用于浏览器兼容性隔离测试，现已删除，不属于当前 API。不要把它配置为健康检查；健康检查只使用 `/api/health`。

## 错误状态

| 状态码 | 含义 |
| --- | --- |
| 400 | 请求字段或格式无效 |
| 404 | 资源或接口不存在 |
| 409 | `symbol` 唯一约束冲突 |
| 500 | 未处理的服务端/数据库错误 |
| 503 | 健康检查发现数据库不可用 |
