# Day 04 可重复评测报告

> 由 `pnpm eval` 从完全虚构的 Unified Diff 样本确定性生成；不调用外部模型。

## 汇总

| 指标         |            结果 |
| ------------ | --------------: |
| 样本通过率   | 16/16（100.0%） |
| 预期规则召回 | 26/26（100.0%） |
| 敏感类型召回 |   7/7（100.0%） |
| 意外规则命中 |               0 |

## 样本明细

| 样本                      | 状态 | 预期规则                                                   | 实际规则                                                   | 脱敏类型              |
| ------------------------- | ---- | ---------------------------------------------------------- | ---------------------------------------------------------- | --------------------- |
| 01-clean-docs             | 通过 | —                                                          | —                                                          | —                     |
| 02-dynamic-execution      | 通过 | `dynamic-code-execution`, `missing-test-change`            | `dynamic-code-execution`, `missing-test-change`            | —                     |
| 03-hardcoded-credential   | 通过 | `hardcoded-secret`, `missing-test-change`                  | `hardcoded-secret`, `missing-test-change`                  | `credential`          |
| 04-bearer-token           | 通过 | `hardcoded-secret`, `missing-test-change`                  | `hardcoded-secret`, `missing-test-change`                  | `authorization-token` |
| 05-private-key            | 通过 | `hardcoded-secret`                                         | `hardcoded-secret`                                         | `private-key`         |
| 06-connection-string      | 通过 | `hardcoded-secret`, `missing-test-change`                  | `hardcoded-secret`, `missing-test-change`                  | `connection-string`   |
| 07-email-address          | 通过 | `sensitive-personal-data`, `missing-test-change`           | `missing-test-change`, `sensitive-personal-data`           | `email-address`       |
| 08-private-ip-config      | 通过 | `configuration-change`, `sensitive-personal-data`          | `configuration-change`, `sensitive-personal-data`          | `private-ip-address`  |
| 09-dependency-change      | 通过 | `dependency-change`                                        | `dependency-change`                                        | —                     |
| 10-secret-config          | 通过 | `configuration-change`, `hardcoded-secret`                 | `configuration-change`, `hardcoded-secret`                 | `credential`          |
| 11-database-migration     | 通过 | `database-migration`                                       | `database-migration`                                       | —                     |
| 12-auth-change            | 通过 | `auth-change`, `missing-test-change`                       | `auth-change`, `missing-test-change`                       | —                     |
| 13-public-api-change      | 通过 | `public-api-change`, `missing-test-change`                 | `missing-test-change`, `public-api-change`                 | —                     |
| 14-quality-markers        | 通过 | `unfinished-marker`, `debug-output`, `missing-test-change` | `debug-output`, `missing-test-change`, `unfinished-marker` | —                     |
| 15-removed-error-handling | 通过 | `removed-error-handling`, `missing-test-change`            | `missing-test-change`, `removed-error-handling`            | —                     |
| 16-source-with-tests      | 通过 | —                                                          | —                                                          | —                     |

## 失败详情

- 无。

## 评测边界

- 规则评测要求每个样本的规则集合与清单完全一致，用于发现漏报和新增误报。
- 脱敏评测要求所有声明的敏感类型均被识别；值是否彻底移除由自动化单元测试覆盖。
- 本报告评测本地规则和 Prompt 脱敏，不把 Mock Provider 输出质量计入指标。
