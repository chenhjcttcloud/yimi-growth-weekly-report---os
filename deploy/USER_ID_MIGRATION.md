# 员工 user_id 主身份迁移

业务表、接口、登录会话、员工选择和飞书调用统一使用 `user_id` / `userId`。姓名只用于展示；`employee_identities` 保留飞书 `open_id`、`union_id` 作为外部标识和旧会话兼容映射。

部署前，先通过通讯录验证每个历史 open_id 的 user_id，生成私有 JSON 映射数组（字段 `openId`、`userId`、可选 `unionId`）。不要按姓名猜测；缺失映射或无法唯一关联的历史记录会阻止迁移。

停止应用写入后，在新镜像中运行：

```sh
node scripts/migrate-user-id.mjs --db /app/outputs/live/growth.sqlite --data /app/outputs/live --mapping /app/outputs/backups/user-id-migration-20261026/mapping.json --backup /app/outputs/backups/user-id-cutover --apply
```

去掉 `--apply` 为只读预检。脚本备份 SQLite 和原始 JSON，事务内迁移身份字段、角色配置、任务草稿哈希、评分关系及月度结果主键；保留分数和原文，并恢复发布锁。已迁移时以同一备份目录重复运行，可恢复尚未完成的 JSON 文件替换。

新服务拒绝启动未迁移的旧数据库。回滚须停止新应用，恢复备份数据库及 JSON 后使用旧镜像，不能让旧镜像读取新模式。

验证：`node scripts/test-user-id-migration.mjs`（使用 `db/fixtures/pre-user-id.sql` 的历史模式）；绩效、协作、个人工作区、部门及 SSO 回归脚本另行运行。
