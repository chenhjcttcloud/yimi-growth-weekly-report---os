# 停用外部顾问分享

用户明确没有截图中的外部顾问临时访问需求。本次仅本地修改与验证，上一轮的发布授权不延续；不自动推送生产或仓库，也不改变面向员工的HTTPS站点或飞书登录。

- 系统设置→角色与权限只保留内部人员的角色管理，不展示外部顾问卡片，不请求分享名单，不提供生成按钮。
- `/api/external-links` 及其子路径不论方法均返回410，错误码 `external_access_disabled`。`/share` 和 `/share/*` 显示停用说明与员工飞书登录入口，不创建外部会话。
- 对仍携带有效签名的旧外部cookie，在开发视角接口及普通鉴权之前识别并阻断。包含有效、过期、撤回、旧格式、`externalShare`、外部角色与 `external:` 身份前缀，不让失效外部会话回退为mock演示老板。
- 允许登录、飞书回调、显式退出和公开健康检查走各自正常流程，便于原访客通过真实员工身份重新登录。没有自动清空cookie后继续走mock回退。
- 旧 `external_share_links` 记录与访问次数完整保留，不删除账号、分享记录、备份或任何项目文件。旧链接失效由关闭访问入口保证，不依赖逐条改写历史状态。

专项测试 `scripts/test-external-sharing-disabled.mjs` 使用隔离mock与真实认证模式的伪服务配置，包含入口/方法矩阵、旧外部cookie、权限与登录恢复、内部3种角色、页面与网络请求检查。不会请求真实飞书或发送消息，所有产物保留于 `outputs/tests/external-sharing-disabled-*`。该轮完整回归 `npm run test:business` 当时为34组业务测试加TypeScript与安全构建，共36项检查。

2026-10-28 该轮完整结果：`outputs/tests/business-regression-7gEELU/result.json` 36/36通过，零失败。CI使用 `BUSINESS_TEST_SKIP_BROWSER=true` 执行同一脚本的API部分，明确标记未检查浏览器；本机默认模式同时验证两种鉴权模式的页面。

本机OrbStack预览已更新，真实页面截图与验证位于 `outputs/local-role-preview/no-external-lWejJf/`：3位真实授权人员保留，没有外部卡片或相关网络请求，旧分享页返回410并提供员工飞书登录入口。历史分享表、35位员工和老板／管理员授权均保持原样。

更新前代码与静态文件快照 `outputs/local-backups/before-disable-external-sharing-20261028-8y4km_vc/`，数据库备份 `4fc5aff2-a49f-41d1-aff2-c05fe3afb6ed` 独立恢复校验passed。没有生产连接、生产变更、Git提交或仓库推送。
