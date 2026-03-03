# Project_Advanced_Contract


三、EasySwapContract 测试流程
1、先配置.env 环境变量
# Ethereum Mainnet
MAINNET_PK=0x2a18c62db90c2e2120d3a4a87ac4ea6574fcc476009792e29a9fb8e7b9d99e2f
MAINNET_SIGNER_PK=0xa5b6b59bb62133207488c8b989a280e5f312880e4bfec41d70c2ead508bf88fd
MAINNET_ALCHEMY_AK=icl-kbMqVYCo6bnyMqFwk

# Sepolia Testnet
SEPOLIA_ALCHEMY_AK=c5daace64d64444790a8d4bdd7c027a6
SEPOLIA_PK_ONE=0x2a18c62db90c2e2120d3a4a87ac4ea6574fcc476009792e29a9fb8e7b9d99e2f
SEPOLIA_PK_TWO=0xa5b6b59bb62133207488c8b989a280e5f312880e4bfec41d70c2ead508bf88fd

2、配置hardhat.config.js 配置hardhat 框架的配置
networks: {
    mainnet: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${MAINNET_ALCHEMY_AK}`,
      accounts: [`${MAINNET_PK}`],
      saveDeployments: true,
      chainId: 1,
    },
    sepolia: {
      // url: `https://eth-sepolia.g.alchemy.com/v2/${SEPOLIA_ALCHEMY_AK}`,
      url: `https://sepolia.infura.io/v3/${SEPOLIA_ALCHEMY_AK}`,
      accounts: [`${SEPOLIA_PK_ONE}`, `${SEPOLIA_PK_TWO}`],
    },
    // optimism: {
    //   url: `https://rpc.ankr.com/optimism`,
    //   accounts: [`${MAINNET_PK}`],
    // },
  },
配置好url 以及accounts，将环境变量写入

四、使用deploy.js 部署脚本 部署合约
npx hardhat run deploy.js

按照合约依赖顺序，分别部署合约，以及建立合约连接
1、先部署金库合约EasySwapVault.sol
2、再部署订单簿合约 EasySwapOrderBook.sol
3、调用金库合约实例，调用 setOrderBook(esDexAddress) 函数 建立合约连接

五、interact.js 交互脚本
npx hardhat run interact.js

1、按照已部署的合约地址，填写好全局变量，后续使用对应的合约实例，进行测试交互
const esDex_name = "EasySwapOrderBook";
const esDex_address = "0xCc5CA9A99d856a3506FB041559fa4516A1fCcb9C"

const esVault_name = "EasySwapVault";
const esVault_address = "0x12522b4d3e283551021E04f40eF537d4e39A9F1F"

const erc721_name = "TestERC721"
const erc721_address = "0x567E645b22d6aB60C43C35B0922669D82e3A3661"

六、TestEasySwap.js 
npx hardhat test 

一、先启动EasySwapSync 模块 同步区块链数据到本地
### Mysql & Redis
docker 容器里先跑起mysql 和radis 服务
#docker compose up -d
#docker ps'

### Set Config file
Copy config/config.toml.example to config/config.toml. 
将模板的url替换为可用的测试网url
https_url="https://sepolia.infura.io/v3/c5daace64d64444790a8d4bdd7c027a6" #测试网的url

[easyswap_market]
apikey = ""
name = "EasySwap"
version= "1"
contract= "0xCc5CA9A99d856a3506FB041559fa4516A1fCcb9C" //上面部署好的合约地址

### set database table
``shell
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

二、开启后端程序，和前端api 交互，返回EasySwapSync同步的信息

1、`cp config/config.toml.example  config/config.toml`


2、go run src/main.go

