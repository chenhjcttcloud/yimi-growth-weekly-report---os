# 生产服务器容器部署

服务器：8.135.51.39，独立目录 `/opt/emie-growth-os`，Compose 项目 `emie-growth-os-production`。

初次部署时域名和 SSO 尚未登记，容器只监听服务器 `127.0.0.1:5180`，开发视角仅通过 SSH 隧道预览，不开放公网入口。

本机运行 `deploy/open-production-preview.sh` 并保持终端打开，然后访问 http://127.0.0.1:5181 。临时后台隧道结束后可用这个脚本重新连接。

服务管理（在服务器目录中执行；当前容器采用保留旧容器的发布方式）：

```sh
cd /opt/emie-growth-os
docker ps -a --filter name=emie-growth-os
docker logs --tail 100 emie-growth-os-production-app-1
docker restart emie-growth-os-production-app-1
```

`data/live/growth.sqlite` 和同目录 JSON 是实时数据；`.env` 为独立生产配置，服务密钥用于解密数据库中加密的飞书与 AI 凭据。备份和迁移时应同时妥善保留，禁止提交仓库或公开分发。

域名确定后：设置 DNS、增加独立 Nginx 站点及 HTTPS、更新 `.env` 中的 `BASE_URL`、在飞书后台登记正式 `/auth/feishu/callback`、核实老板与管理员的真实员工身份和应用可用范围，再切换 `AUTH_MODE=feishu` 并关闭 `DEV_VIEW_SWITCH_ENABLED`。本次公网试运行已按下文配置执行。

生产端开启每 15 分钟采集飞书汇报并复用已有 AI 分析。任务创建和提醒发送保持关闭，需要另行配置权限和目标后再启用。


## 公网试运行（2026-10-23）

正式新站点：https://growth.emie.cn ，旧版 https://reportos.emie.cn 保留。

生产配置现为 `AUTH_MODE=feishu`、`DEV_VIEW_SWITCH_ENABLED=false`、`BASE_URL=https://growth.emie.cn`。HTTP 自动跳转 HTTPS；Nginx 配置为 `/etc/nginx/conf.d/growth-os-production.conf`，反向代理容器 `127.0.0.1:5180`。证书位于 `/etc/letsencrypt/live/growth.emie.cn`，Certbot 使用 webroot 自动续期，并在续期后 reload Nginx。

飞书回调：https://growth.emie.cn/auth/feishu/callback 。老板为谭健荣，管理员为刘海娇和陈浩杰，已按飞书 user_id 保存授权并验证权限。实际 SSO 授权登录仍需用户本人完成。

本机开发环境的同步开关由本机数据库独立管理，生产配置与数据不从本机覆盖。原 SSH 预览通道仅作为运维通道，正式访问请使用 HTTPS 域名。


2026-10-26：管理员右上角提供「管理视角 / 我的个人视角」切换，仅改变本人工作界面，不切换账号，不提升权限。选择按员工身份保存在浏览器中。部署镜像：`emie-growth-os:production-20261026-views`。

2026-10-26 补充：管理员可在右上角选择「员工视角预览（只读）」中的具体姓名。使用独立的管理预览 GET 接口读取指定员工工作区和待评分任务，不改变登录身份；预览不允许评分提交、评论、提醒、AI 追问或创建任务。部署镜像：`emie-growth-os:production-20261026-preview`。

2026-10-26 部门模块：左侧「部门管理」提供部门概览、组织与负责人、负责人评分。成员归属继续来自飞书，支持一人多部门；旧的未配置复合部门标签不再作为独立部门展示，但数据库记录保留。部门月度统计按当前成员身份汇总，最终分与 AI 参考分分开。老板独立评分权限由后端校验，管理员只能查看。升级前数据库备份位于 `data/backups/before-departments-20261026.sqlite`，Compose 备份位于 `backups/compose-before-departments-20261026.yaml`。镜像：`emie-growth-os:production-20261026-departments`。

2026-10-26 飞书组织架构同步：已读取并同步 15 个具名部门与 11 个负责人，新增 2 个部门，原有 13 个部门 ID 保留。`feishu_department_links` 按飞书 open_department_id 关联本地部门，保存父部门、负责人姓名、人数及同步时间；更名时保留旧名别名以匹配历史周报。上级部门成员与月度统计包含子部门并按员工 ID 去重。管理员可在「部门管理 → 同步飞书部门」手动更新；同步不会新增员工账号或更改历史负责人评分。同步前备份：`data/backups/before-feishu-departments-20261026.sqlite`。镜像：`emie-growth-os:production-20261026-feishu-departments`。
