# 访问与审阅流程

## 公开访问方式

代码在 [GitHub](https://github.com/chenhjcttcloud/yimi-growth-weekly-report---os) 与 [Gitee](https://gitee.com/Lucascloud/yimi-growth-weekly-report---os) 同步维护。任何人都可以阅读和 Fork 公开仓库：

```bash
git clone https://github.com/chenhjcttcloud/yimi-growth-weekly-report---os.git emie-growth-os
```

公开访问不包含生产服务器、真实业务数据、飞书应用凭据或直接写入权限。

获得用户推送指令时，必须按 [AGENTS.md](../AGENTS.md) 和 [双仓库同步推送规则](../CONTRIBUTING.md#双仓库同步推送)，同步两个仓库的同一分支和提交，并分别核对远端 SHA。原 `brotherjean/emie-growth-os` 仅保留为历史来源。

## IT 开发流程

推荐通过 Fork 或功能分支提交 Pull Request：

```bash
git clone https://github.com/<your-account>/yimi-growth-weekly-report---os.git emie-growth-os
cd emie-growth-os
npm ci
git switch -c feature/<主题>
```

完成修改和验证后：

```bash
git push -u origin feature/<主题>
gh pr create --repo chenhjcttcloud/yimi-growth-weekly-report---os --base main --fill
```

PR 会自动运行 CI。维护者重点审阅行为变化、权限范围、数据安全、验证证据和回滚方式。

## 直接协作者

需要直接在主仓库建立分支时，由仓库所有者使用 GitHub 账号单独邀请：

1. 打开仓库 `Settings`。
2. 进入 `Collaborators`。
3. 点击 `Add people`，输入开发者 GitHub 用户名。
4. 开发者仍应从独立分支提交 PR，不直接推送 `main`。

CLI 邀请方式：

```bash
gh api --method PUT repos/chenhjcttcloud/yimi-growth-weekly-report---os/collaborators/<github-username> -f permission=push
```

## 合并与生产发布边界

- `main` 应始终保持可构建，功能修改通过 PR 合并。
- GitHub 合并不等于生产发布；生产发布需要独立备份、构建、数据校验和人工确认。
- 未经审阅的 PR 不得直接连接生产飞书应用或生产数据库。
- Issue、PR、Actions 日志和截图中不得出现真实员工数据或凭据。

仓库保留 CODEOWNERS、PR 模板和 GitHub Actions CI。合并及同步不得删除分支或改写已有历史；生产发布仍需本次单独授权。
