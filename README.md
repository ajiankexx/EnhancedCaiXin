# EnhancedCaiXin

EnhancedCaiXin 是一个财新网相关的浏览器插件项目。

## Project Structure

- `plugin/`: 浏览器插件代码。执行 `./deploy.sh` 时会同步该目录到 Windows 插件加载路径。
- `front-end/`: Vue3 前端代码。
- `server/`: Go 本地后端服务，供浏览器插件通过 localhost 调用并访问 MySQL。
- `sql/`: MySQL 相关文件，包含数据库迁移脚本和部署脚本。
- `deploy.sh`: 插件部署脚本，默认同步 `plugin/` 到 `/mnt/e/ChromeExtension/EnhancedCaiXin`。
- `sql/deploy_mysql.sh`: 使用 Docker 部署 MySQL 并执行 `sql/migrations` 下未执行过的迁移。

## Deploy Plugin

```bash
./deploy.sh
```

默认部署到：

```text
/mnt/e/ChromeExtension/EnhancedCaiXin
```

可通过 `DEPLOY_DIR` 或 `SOURCE_DIR` 临时覆盖：

```bash
DEPLOY_DIR=/path/to/target ./deploy.sh
SOURCE_DIR=/path/to/plugin ./deploy.sh
```

## Deploy MySQL

```bash
./sql/deploy_mysql.sh
```

默认连接信息：

```text
Host: 127.0.0.1
Port: 3307
Database: enhanced_caixin
User: caixin_app
Password: caixin_app_password
```

数据库表结构通过 `sql/migrations/*.sql` 管理。后续结构变化时新增迁移文件，不直接修改已执行过的迁移。

如果本地 MySQL 已经存在旧表结构，并且开发数据可以删除，可以先清理容器和数据卷后重新部署：

```bash
CONFIRM=enhanced-caixin ./sql/clear_mysql.sh
MYSQL_IMAGE=mysql:8.0.39 ./sql/deploy_mysql.sh
```

## Run Local Server

```bash
cd server
go mod tidy
go run ./cmd/server
```

默认监听 `http://127.0.0.1:1234`，插件默认通过 `POST /api/articles` 保存文章。

## Article Favorites

插件浮动面板支持文章收藏：

- 收藏或取消收藏当前文章。
- 新建收藏夹，并把同一篇文章收藏到多个收藏夹。
- 在插件面板内按收藏夹筛选查看收藏列表。

服务端新增接口：

- `GET /api/favorite-folders`: 查询收藏夹。
- `POST /api/favorite-folders`: 创建收藏夹，请求体为 `{ "name": "收藏夹名称" }`。
- `GET /api/articles/{caixin_id}/favorite`: 查询文章收藏状态。
- `POST /api/articles/{caixin_id}/favorite`: 保存文章收藏夹，请求体为 `{ "folder_ids": [1, 2] }`；空数组会使用默认收藏夹。
- `DELETE /api/articles/{caixin_id}/favorite`: 取消收藏文章。
- `GET /api/favorites?folder_id=1&limit=50&offset=0`: 查询收藏文章列表。
