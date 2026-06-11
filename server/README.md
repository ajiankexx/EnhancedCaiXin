# EnhancedCaiXin Server

本目录是浏览器插件使用的本地后端服务，使用 Go 实现，默认监听：

```text
http://127.0.0.1:8080
```

## 功能

- `GET /healthz`: 健康检查。
- `POST /api/articles`: 保存或更新文章，供插件默认配置调用。
- `GET /api/articles/{caixin_id}`: 按财新文章 ID 查询文章。

当前数据库表没有单独的正文列，服务会把请求中的 `content` 写入 `reserved_1`，并在查询结果中同时返回为 `content`。

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
SERVER_ADDR=127.0.0.1:8080
```

也可以直接使用 `MYSQL_DSN` 覆盖完整连接串：

```bash
MYSQL_DSN='caixin_app:caixin_app_password@tcp(127.0.0.1:3307)/enhanced_caixin?parseTime=true&loc=Local&charset=utf8mb4,utf8' go run ./cmd/server
```
