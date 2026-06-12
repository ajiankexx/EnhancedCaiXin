# MySQL Deployment Notes

本文记录本项目 MySQL Docker 部署最终成功的过程。

## 背景

项目的 MySQL 部署脚本位于：

```bash
./sql/deploy_mysql.sh
```

脚本默认使用的镜像是 `mysql:8.4`，但部署时本机没有该镜像，且 Docker daemon 拉取 Docker Hub 镜像失败：

```text
Unable to find image 'mysql:8.4' locally
docker: Error response from daemon: Get "https://registry-1.docker.io/v2/": EOF
```

本机已有可用 MySQL 镜像：

```text
mysql:8.0.39
mysql:latest
```

最终使用本地已有的 `mysql:8.0.39` 镜像完成部署。

## 成功部署命令

第一次基于本地镜像运行脚本：

```bash
MYSQL_IMAGE=mysql:8.0.39 ./sql/deploy_mysql.sh
```

如果之前已经创建过异常初始化的容器或数据卷，需要先清理，再重新部署：

```bash
docker rm -f enhanced-caixin-mysql
docker volume rm enhanced-caixin-mysql-data
MYSQL_IMAGE=mysql:8.0.39 ./sql/deploy_mysql.sh
```

成功输出包含：

```text
Waiting for MySQL to be ready...
Applying migration: 001_initial_articles
MySQL is ready.
Container: enhanced-caixin-mysql
Database:  enhanced_caixin
User:      caixin_app
Host:      127.0.0.1
Port:      3307
```

## 验证命令

查看容器状态：

```bash
docker ps --filter name=enhanced-caixin-mysql --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

成功状态示例：

```text
enhanced-caixin-mysql	mysql:8.0.39	Up ...	33060/tcp, 0.0.0.0:3307->3306/tcp, [::]:3307->3306/tcp
```

验证 MySQL 是否 ready：

```bash
docker exec -e MYSQL_PWD=enhanced_caixin_root_password enhanced-caixin-mysql mysqladmin ping -uroot --silent
```

成功输出：

```text
mysqld is alive
```

验证迁移记录：

```bash
docker exec -e MYSQL_PWD=enhanced_caixin_root_password enhanced-caixin-mysql \
  mysql -N -uroot enhanced_caixin \
  -e 'SELECT version FROM schema_migrations ORDER BY version;'
```

成功输出：

```text
001_initial_articles
```

## 最终连接信息

```text
Host: 127.0.0.1
Port: 3307
Database: enhanced_caixin
User: caixin_app
Password: caixin_app_password
Container: enhanced-caixin-mysql
Image: mysql:8.0.39
```

## 注意事项

- 当前成功部署依赖本地已有镜像 `mysql:8.0.39`。
- 如果要使用脚本默认镜像 `mysql:8.4`，需要先确保 Docker daemon 能正常拉取 Docker Hub 镜像，或提前将该镜像拉取到本地。
- MySQL 官方镜像只会在数据目录首次初始化时应用 `MYSQL_ROOT_PASSWORD` 等初始化变量。若数据卷已经存在，修改环境变量不会重置 root 密码；需要删除旧容器和旧数据卷后重新创建。
