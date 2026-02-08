# EasySwapSync
EasySwapSync is a service that synchronizes EasySwap contract events from the blockchain to the database.

## Prerequisites
### Mysql & Redis
You should get your MYSQL & Redis running and create a database inside. MYSQL & Redis inside docker is recommended for local testing.
For example, if the machine is arm64 architecture, you can use the following docker-compose file to start mysql and redis.
```shell
docker-compose -f docker-compose-arm64.yml up -d
#docker compose up -d
#docker ps'

```

For more information about the table creation statement, see the SQL file in the db/migrations directory.

### Set Config file
Copy config/config.toml.example to config/config.toml. 
And modify the config file according to your environment, especially the mysql and redis connection information.
And set contract address in config file.


### set database table
```shell
#步骤 2：进入 MySQL 容器
docker exec -it mysql_easyswap mysql -u easyuser -p
#步骤 3：进入数据库
USE easyswap;
SHOW TABLES LIKE 'ob_indexed_status';

#步骤 4：初始化区块游标（必做）
SELECT id, chain_id, index_type, last_indexed_block FROM ob_indexed_status;

INSERT INTO ob_indexed_status
(
  chain_id,
  index_type,
  last_indexed_block,
  last_indexed_time,
  create_time,
  update_time
)
VALUES
(11155111, 6, 10189593, NOW(), NOW(), NOW()),
(11155111, 5, 10189593, NOW(), NOW(), NOW());
```
## Run
Run command below
```shell
go run main.go daemon