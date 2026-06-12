# EnhancedCaiXin Server

本目录是浏览器插件使用的本地后端服务，使用 Go 实现，默认监听：

```text
http://127.0.0.1:1234
```

## 功能

- `GET /healthz`: 健康检查。
- `POST /api/articles`: 保存文章，供插件默认配置调用；如果 `caixin_id` 已存在，则直接返回已有记录，不重复写入。
- `GET /api/articles/{caixin_id}`: 按财新文章 ID 查询文章。

服务会把请求中的 `content` 写入数据库的 `content` 字段，并在首次保存时生成 `add_time` 作为文章进入数据库的时间。`reserved_3` 到 `reserved_5` 暂时保持为空。

## 运行

先启动 MySQL：

```bash
./sql/deploy_mysql.sh
```

再启动服务：

```bash
cd server
go mod tidy
go run ./cmd/server
```

默认数据库连接参数与 `sql/deploy_mysql.sh` 保持一致：

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_DATABASE=enhanced_caixin
MYSQL_USER=caixin_app
MYSQL_PASSWORD=caixin_app_password
SERVER_ADDR=127.0.0.1:1234
```

如需自定义端口，可以在启动时覆盖 `SERVER_ADDR`：

```bash
SERVER_ADDR=127.0.0.1:5678 go run ./cmd/server
```

也可以直接使用 `MYSQL_DSN` 覆盖完整连接串：

```bash
MYSQL_DSN='caixin_app:caixin_app_password@tcp(127.0.0.1:3307)/enhanced_caixin?parseTime=true&loc=Local&charset=utf8mb4,utf8' go run ./cmd/server
```

## 日志

服务输出结构化文本日志到标准输出。每个 HTTP 请求都会记录：

```text
method path status duration_ms remote_addr origin user_agent
```

保存文章时还会记录：

```text
caixin_id url title has_content
```

如果保存失败，日志会包含 `save article failed` 和 MySQL 返回的 `error` 字段。
