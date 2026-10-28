# 协作开发指南

## 分支与 PR

- `main` 始终保持可构建。
- 功能开发使用 `feature/<主题>`。
- Bug 修复使用 `fix/<主题>`。
- 分析和数据规则实验使用 `analysis/<主题>`。
- 不直接向 `main` 推送功能修改；通过 Pull Request 提交给仓库所有者审阅。

## 修改原则

1. 每个 PR 只解决一个明确问题，避免顺手重构无关代码。
2. 延续现有 React、TypeScript、Node 和 CSS 风格。
3. PR 必须说明目标、影响页面/API、数据迁移、验证方式和回滚方式。
4. 涉及权限、消息、任务、数据库和自动化时，要明确 dry-run 与真实写入边界。

## 双仓库同步推送

所有推送操作必须遵守 [AGENTS.md](AGENTS.md)。用户要求推送代码时，同一次操作同步到两个仓库的相同分支和相同提交：

| 远端名 | 仓库地址 |
|---|---|
| `github` | https://github.com/chenhjcttcloud/yimi-growth-weekly-report---os.git |
| `gitee` | https://gitee.com/Lucascloud/yimi-growth-weekly-report---os.git |

本地尚未配置时，先核对已有远端，再添加缺少的远端；不要覆盖或删除已有配置。GitHub 当前推送使用已配置的 SSH 认证，HTTPS 地址也可用于读取。

推送前读取两个远端分支状态，确保不会覆盖已有历史。以已获授权推送的 `main` 为例：

```bash
git push github main:main
git push gitee main:main
git ls-remote github refs/heads/main
git ls-remote gitee refs/heads/main
git rev-parse main
```

最后三项的提交 SHA 必须一致。功能分支同样同步到两个仓库的对应分支；如一边失败，报告部分成功，保留已成功推送的提交并补推失败的一边。不得强推或使用镜像推送覆盖远端。原 `brotherjean/emie-growth-os` 保留为历史来源，不再作为默认推送目标。

代码推送、PR 合并和生产部署是不同操作。普通本地修改不自动推送；只有本次获得明确生产部署指令才能上线，CI 不得自动部署生产。

## 必做检查

```bash
npm ci
npm run build
node scripts/test-closure-insights.mjs
node scripts/test-scoring360-policy.mjs
```

修改 Kimi 静态数据结构时再运行：

```bash
npm run static:validate
```

## 数据安全

禁止提交：

- 批量员工名单、open_id、邮箱、手机号和组织映射
- 新增代码中硬编码的真实姓名；授权名单和豁免名单必须通过环境变量配置
- 周报原文、评论、AI 对话、360 评价明细和访问日志
- `.env`、API Key、App Secret、token、SSH 私钥
- SQLite、Excel、CSV、outbox、构建产物和服务器备份

测试必须使用虚构人员和匿名内容。若需要复现生产问题，只保留最小结构，不复制业务正文。

## PR 审阅重点

- 行为是否符合需求且没有扩大权限范围
- 是否影响历史周期、现有数据或飞书真实写入
- 是否有可复现验证证据
- 是否包含生产数据或密钥
- 是否提供必要的回滚说明
