# 产品管理系统：月度评分对接接口

产品管理系统后端通过此接口读取成长周报 OS 的月度周报质量分和 360 协同分，按同一飞书租户内的 `user_id` 关联人员，并用姓名核对。接口只读已有评分快照，不触发 AI 分析、重算、发布或历史版本写入，也不返回周报正文、评分评价和凭据。

本文描述接口契约。生产实例需要独立配置服务端令牌才能启用；仓库推送、令牌配置和生产部署遵守项目发布规则。

## 1. 地址和认证

| 项目 | 约定 |
| --- | --- |
| 路径 | `/api/integrations/product-management/monthly-scores` |
| 方法 | `GET` 单人查询；`POST` 批量查询 |
| 认证 | `Authorization: Bearer <token>` |
| 本地联调地址示例 | `http://127.0.0.1:5174`，以实际启动的本地 API 端口为准 |
| 生产地址 | `https://growth.emie.cn`，须在后端配置独立接口令牌 |
| 缓存 | 响应不可缓存；调用方按人员、月份和评分类型保存结果 |

成长周报 OS API 进程读取环境变量 `PRODUCT_MANAGEMENT_SCORE_API_TOKEN`。令牌须为 32～4096 个可打印 ASCII 字符，不含空白。未配置或配置不符合要求时，此接口禁用，返回 `503 score_api_not_configured`。其他系统功能继续使用原有认证方式。

可在受控终端生成随机令牌，下面命令只用于生成，不会配置生产：

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('base64url'));"
```

将生成值通过现有运行方式的环境变量注入成长周报 OS API 进程和产品管理系统后端，重启对应 API 进程后生效。示意配置如下，尖括号内容必须替换：

```dotenv
PRODUCT_MANAGEMENT_SCORE_API_TOKEN=<至少32字符的随机令牌，仅服务端保存>
```

令牌仅授权这个评分摘要接口，不能调用人员管理、评分提交或其他管理接口。飞书登录 Cookie、老板或管理员身份也不能代替此令牌。令牌不得进入前端 JavaScript、浏览器存储、URL、Git、截图或普通业务日志。产品管理系统应从自己的后端调用，不向浏览器开放该令牌或依赖跨域访问。

### 本地隔离副本联调

使用本项目已有的隔离生产数据副本时，可将独立的本地测试令牌保存在 `<本地隔离副本>/working/product-management-score-api.env`。文件必须为权限 `0600` 的普通文件，不能是符号链接，且只能有下面这一行；不得加 `export`、引号、注释或其他环境变量：

```dotenv
PRODUCT_MANAGEMENT_SCORE_API_TOKEN=<独立生成的本地随机令牌>
```

本机隔离副本位置可查看已被 Git 忽略的 `outputs/local-preview-runtime.json`，不在本文固定机器路径。运行 `npm run dev:local` 后，启动脚本验证该文件并只把这一个令牌配置转发给本地容器，不读取项目根目录 `.env` 转发其他集成凭据。文件不存在时，此接口保持未配置状态。

启动完成后，可通过 `http://127.0.0.1:5174` 或 `http://127.0.0.1:5180` 调用本地 API；产品管理系统本地后端使用相同的本地令牌。该文件、令牌及隔离副本留在被忽略的本地目录，生产使用另行配置的令牌。本地联调不启用真实飞书、AI 或消息发送，也不授予生产部署权限。

## 2. 人员与月份规则

- `month` 必填，格式为 `YYYY-MM`，例如 `2026-10`。一次请求只查询一个月份。
- 每位人员必须同时提供 `feishuUserId` 和 `name`。`feishuUserId` 必须是飞书 `user_id`，不是 `open_id`、`union_id`、手机号或姓名。
- 两个系统必须属于同一飞书租户。飞书 `user_id` 是租户内身份，`open_id` 则是应用内身份，不可直接用于跨应用关联。详见[飞书官方用户身份说明](https://open.feishu.cn/document/platform-overveiw/basic-concepts/user-identity-introduction/introduction)。
- 先按 `user_id` 精确查找，再对去除首尾空白并按 Unicode NFC 规范化后的姓名做精确核对；不会删除姓名中的括号、内部空格或其他内容。不得只凭姓名关联，也不会在 ID 未找到时转查同名人员。`ou_` 形式的 `open_id` 不支持。
- ID 存在但姓名不符时，返回 `name_mismatch`，分数为空。调用方应先同步双方人员资料，不能自行改为姓名匹配。改名不改变本接口以 ID 为主的关联规则。
- 已停用人员仍可查询其历史月份，返回 `employee.active: false`。停用状态不清空历史分数。
- `POST` 最多 100 位人员，请求体最多 64 KiB；同一次请求重复的 `feishuUserId` 会被拒绝。
- `GET` 只接受 `month`、`feishuUserId`、`name` 三个参数，各出现一次；未知参数、重复参数或缺失参数均返回 `400 invalid_score_request`。ID 和姓名规范化后最长各 200 字符，ID 不能包含空白，两个字段都不能包含控制字符或不可见格式字符。

## 3. 请求示例

以下人员、姓名均为虚构示例。先在调用终端设置本地地址及令牌变量，真实令牌不要写进文档或提交脚本：

```bash
export GROWTH_OS_BASE_URL='http://127.0.0.1:5174'
# GROWTH_OS_SCORE_TOKEN 应由本地私密配置或密钥管理工具注入。
```

单人查询：

```bash
curl --get "$GROWTH_OS_BASE_URL/api/integrations/product-management/monthly-scores" \
  --header "Authorization: Bearer $GROWTH_OS_SCORE_TOKEN" \
  --data-urlencode 'month=2026-10' \
  --data-urlencode 'feishuUserId=example_employee_a' \
  --data-urlencode 'name=示例员工甲'
```

批量查询：

```bash
curl "$GROWTH_OS_BASE_URL/api/integrations/product-management/monthly-scores" \
  --header "Authorization: Bearer $GROWTH_OS_SCORE_TOKEN" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "month": "2026-10",
  "employees": [
    {"feishuUserId": "example_employee_a", "name": "示例员工甲"},
    {"feishuUserId": "example_employee_b", "name": "示例员工乙"}
  ]
}
JSON
```

请求中的令牌只放在 `Authorization` 请求头，不接受 URL 参数或 JSON 字段传令牌。

## 4. 成功响应

`GET` 和 `POST` 均返回 `data` 数组。`POST` 保留请求人员顺序；部分人员未匹配不会阻断其他已匹配人员。

```json
{
  "ok": true,
  "apiVersion": "1",
  "month": "2026-10",
  "generatedAt": "2026-11-05T02:00:00.000Z",
  "data": [
    {
      "input": {"feishuUserId": "example_employee_a", "name": "示例员工甲"},
      "matchStatus": "matched",
      "employee": {
        "feishuUserId": "example_employee_a",
        "name": "示例员工甲",
        "department": "示例部门",
        "active": true
      },
      "weeklyQuality": {
        "score": 87.5,
        "status": "published",
        "isFinal": true,
        "previousScore": null,
        "source": "management_confirmed",
        "updatedAt": "2026-10-31T12:00:00.000Z",
        "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "collaboration360": {
        "score": 90.2,
        "status": "published",
        "isFinal": true,
        "previousScore": null,
        "source": "weighted_30_70",
        "updatedAt": "2026-10-31T13:00:00.000Z",
        "revision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    }
  ],
  "totals": {"requested": 1, "matched": 1, "unmatched": 0}
}
```

| 字段 | 含义 |
| --- | --- |
| `apiVersion` | 接口契约版本，当前为字符串 `"1"` |
| `generatedAt` | 本次响应生成时间，ISO 8601 UTC，不是评分发布时间 |
| `input` | 本条查询对应的人员 ID 和姓名 |
| `matchStatus` | `matched`、`not_found` 或 `name_mismatch` |
| `employee` | OS 中核对到的人员资料；未找到时为 `null` |
| `weeklyQuality` | 指定月份的周报质量月分，**不是某一周的分数** |
| `collaboration360` | 指定月份已发布的 360 协同最终分，**不是同事互评部分的均分** |
| `score` | 当前可使用的 0～100 数值或 `null`；0 是有效分数 |
| `isFinal` | 是否为本接口当前可供业务采用的最终结果 |
| `previousScore` | 兼容字段，当前返回 `null` |
| `source` | `management_confirmed` 人工确认的周报质量分、`legacy` 历史人工结果、`automatic_report` 自动计算的质量进度或 `weighted_30_70` 月度加权结果 |
| `updatedAt` | 该结果已保存的更新时间，标准 ISO 8601 UTC 或 `null` |
| `revision` | 评分摘要的稳定 SHA-256 版本标识，用于发现变更；不能按字符串大小判断先后 |

`name_mismatch` 时，`employee` 返回该 ID 在 OS 中的当前真实姓名及资料，供调用方核对；两类分数均为 `status: "identity_mismatch"`，`score`、`previousScore`、`source`、`updatedAt`、`revision` 全为 `null`，`isFinal` 为 `false`。`not_found` 时，`employee` 也为 `null`，分数对象采用同样的空值规则。

自动质量结果还可能带有 `reportCount`、`pendingAnalysis`、`failedAnalysis`、`previousResultAt` 四个辅助字段，分别表示已保存的报告数量、待分析数量、失败数量及前一结果时间；数量为非负整数或 `null`，时间为标准 ISO 8601 UTC 或 `null`。这些字段不保证在所有来源或状态下出现，不能用它们替代 `status`、`isFinal` 和 `score` 判断可用性。

`generatedAt` 每次查询可以变化；仅重新读取不会改变 `revision`。建议以 `(month, employee.feishuUserId, 评分类型)` 为业务唯一键，结合该类型的 `revision` 幂等更新，不以姓名、`generatedAt` 或两种分数共用的单个版本号作为唯一键。

## 5. 分数与状态

有效周报分析完成后汇总月度候选分，由管理人员确认后供接口同步。及时率单独统计。360 协同最终分为负责人或老板部分 30% 加同事互评部分 70%，必需评分完成后发布。`legacy` 历史人工结果保留原值。

| `status` | `score` / `isFinal` | 调用方处理 |
| --- | --- | --- |
| `published` | 有效数值 / `true` | 可同步为该类型的当前最终分 |
| `not_published` | `null` / `false` | 该类型没有既存结果快照，例如 360 必需评分未完成 |
| `pending_ai` | `null` / `false` | 周报质量分析尚未形成可用结果 |
| `pending_confirmation` | `null` / `false` | 已汇总周报质量候选分，等待管理人员确认 |
| `no_reports` | `null` / `false` | 已保存的质量快照表明该月份没有周报 |
| `rescoring` | `null` / `false` | 质量重评中 |
| `rescore_failed` | `null` / `false` | 质量重评失败 |
| `identity_mismatch` | `null` / `false` | 人员未找到或姓名核对不符，不得写入分数 |
| `invalid_result` | `null` / `false` | 已保存数据不符合有效分数要求，不能作为成绩采用 |

接口不会把未交、未评分、身份未匹配或分析失败填为 0，也不会把重评前的旧分冒充当前最终分。`score` 为 `null` 时必须同时保存状态并显示“待分析”“待评分”“重评中”等相应提示。若产品管理系统已有历史分，保留其历史记录，并标记为非当前可用结果；不要将 `null` 转为 0 或继续展示为本次最终分。

接口只读取快照：没有已保存快照时统一为 `not_published`，不会为了区分待分析和无周报而现场扫描、分析或重算；`pending_ai`、`no_reports` 等细分状态来自已保存的自动质量结果。未匹配或没有快照时，`revision` 为 `null`。

两类结果独立处理：同一个人可能质量分已发布而 360 仍待评分，或质量重评中而 360 已发布。不要因为另一类分数未完成而丢掉已经可用的结果。

## 6. 产品管理系统后端示例

以下为 Node.js 后端的拉取与处理示例。`saveFinalScore`、`recordScoreState` 由产品管理系统按自身存储方式实现；令牌从服务端环境变量读取。

```js
async function syncMonthlyScores(month, employees) {
  const token = process.env.GROWTH_OS_SCORE_TOKEN;
  const baseUrl = process.env.GROWTH_OS_BASE_URL;
  if (!token || !baseUrl) throw new Error('成长周报评分接口尚未配置');

  const response = await fetch(
    new URL('/api/integrations/product-management/monthly-scores', baseUrl),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ month, employees }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await response.json();
  if (!response.ok || body.ok !== true || body.apiVersion !== '1') {
    // 不记录令牌或整个请求头；认证/参数错误应修正配置，不能无限重试。
    throw new Error(`评分接口失败：HTTP ${response.status} / ${body.error || 'invalid_response'}`);
  }

  for (const row of body.data) {
    if (row.matchStatus !== 'matched' || !row.employee) {
      await recordScoreState({ month, input: row.input, identityStatus: row.matchStatus });
      continue;
    }
    for (const kind of ['weeklyQuality', 'collaboration360']) {
      const result = row[kind];
      const key = { month, feishuUserId: row.employee.feishuUserId, kind };
      const valid = result.isFinal === true && result.status === 'published'
        && Number.isFinite(result.score) && result.score >= 0 && result.score <= 100;
      if (valid) {
        // 按 key + revision 幂等写入；不要使用 if (result.score)，否则会丢失有效0分。
        await saveFinalScore({ ...key, score: result.score, revision: result.revision,
          source: result.source, updatedAt: result.updatedAt });
      } else {
        // 只记录待完成/重评状态，不把空值、旧分当作本次最终成绩。
        await recordScoreState({ ...key, status: result.status, isFinal: false,
          previousScore: result.previousScore, revision: result.revision });
      }
    }
  }
}
```

一次查询超过 100 人时，由产品管理系统后端分批请求；每批均携带同一个月份。每批返回各自的 `generatedAt`，不承诺多批之间为同一数据库时刻。网络失败可有限重试；重复读取不会新增评分版本。对接初期可先按月、少量人员联调，再增加定时拉取；本接口不主动向产品管理系统推送，也不提供写入评分的能力。

## 7. 错误响应

错误响应形如 `{"ok":false,"error":"invalid_score_request"}`。不要把整个 HTTP 成功请求中的某位人员 `not_found` 与接口级失败混为一谈；前者在 `data` 中明确返回匹配状态。

| HTTP 状态 | `error` 或含义 | 处理建议 |
| --- | --- | --- |
| `400` | `invalid_score_request` | 检查月份、必填人员字段、ID类型、批量数量，以及 GET 的未知或重复参数 |
| `400` | `duplicate_employee_id` | 同批中每个飞书 `user_id` 只能出现一次 |
| `401` | `unauthorized`，缺失或错误的 Bearer token | 核对两系统服务端令牌，不用飞书 Cookie 替代 |
| `403` | `invalid_origin` | 不接受跨站浏览器 POST；改由产品管理系统后端请求 |
| `405` | `method_not_allowed`，`Allow: GET, POST` | 使用约定方法 |
| `413` | `payload_too_large` | 将批量请求拆小，整个 JSON 不能超过 64 KiB |
| `415` | `json_required` | POST 使用 `Content-Type: application/json` |
| `503` | `score_api_not_configured` | 配置符合要求的服务端令牌并按当前运行方式重启 API 进程 |
| `503` | `score_data_unavailable`，`Retry-After: 5` | 数据暂不可用，至少等待 5 秒后有限重试；响应不会暴露 SQL 细节 |

## 8. 联调验收

至少验证：同名不同 ID 不串号、ID 与姓名不符不出分、停用员工历史分保留、有效 0 分可写入、质量与 360 独立完成、重评旧分不作当前分、重复查询版本稳定、错误令牌被拒绝，以及查询前后评分历史没有新增版本。

将来部署生产时，先由项目所有者明确授权，使用两个系统后端共同保存的随机令牌，验证正式飞书 `user_id` 与姓名，再按本接口状态规则同步；真实令牌、员工数据及联调产物不得提交仓库。
