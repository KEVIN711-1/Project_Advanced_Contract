const { ethers, upgrades } = require("hardhat")
const { Side, SaleKind } = require("../test/common")
const { toBn } = require("evm-bn")

/**
 * 2024/12/22 in sepolia testnet
 * esVault contract deployed to: 0x75EC7448bC37c1FB484520C45b40F1564eBd0d19
 *     esVault ImplementationAddress: 
 *     esVault AdminAddress: 
 * esDex contract deployed to: 0x5560e1c2E0260c2274e400d80C30CDC4B92dC8ac
 *     esDex ImplementationAddress: 
 *     esDex AdminAddress: 
 */

const esDex_name = "EasySwapOrderBook";
const esDex_address = "0xCc5CA9A99d856a3506FB041559fa4516A1fCcb9C"

const esVault_name = "EasySwapVault";
const esVault_address = "0x12522b4d3e283551021E04f40eF537d4e39A9F1F"

const erc721_name = "TestERC721"
const erc721_address = "0x567E645b22d6aB60C43C35B0922669D82e3A3661"

let esDex, esVault, testERC721
let deployer

async function main() {
    [deployer, trader] = await ethers.getSigners()
    
    console.log("deployer: ", deployer.address)
    console.log("trader: ", trader.address)
    
    // 创建去中心化订单薄合约实例
    esDex = await (
        await ethers.getContractFactory(esDex_name)
    ).attach(esDex_address)
    
    // 创建金库合约实例
    esVault = await (
        await ethers.getContractFactory(esVault_name)
    ).attach(esVault_address)
    
    // 创建NFT合约实例
    testERC721 = await (
        await ethers.getContractFactory(erc721_name)
    ).attach(erc721_address)
    
    // 1. setApprovalForAll
    // 卖家准备，授权Vault可以转移自己的NFT
    await approvalForVault();
    
    // 2. make order
    // 创建卖单，挂单出售自己的NFT
    // await testMakeOrder();
    
    // for (let i = 1; i < 20; i++) {
    //     await testMakeOrder(i);
    // }
    
    // 3. cancel order
    // orderkey1 = hash(order1) 每个orderkey都是唯一的，根据唯一的order key取消订单
    // makeOrders函数会返回唯一的orderkeys，并且跟随事件上传到区块链
    // let orderKeys = [];
    // await testCancelOrder(orderKeys);
    
    // let orderKeys1 = ["0x83f92e47c1f20bdc6ccfc0161951684e1fd80c2ef9b5dfc260d58f3b604841bb"]
    // let orderKeys2 = ["0x229667c4fe843fa4fe28eff87138944a182ea884997063f4e9c47c6855f07207",
    //     "0x29ff65687a424edfaea64eddf50ca9e594310c2b5f9d47c1b909454c4eefa3c0"]
    // await testCancelOrder(orderKeys1);
    // await testCancelOrder(orderKeys2);
    
    // 4. match order 
    // await testMatchOrder();
    
    // 买家根据orderkeys主动匹配交易，发起买单
    // let orderKeys = ["e25fe5f3f09ccf383e000a1011486ea4b66ddf797c30fe4ac70507af94d09ff1",
    //     "0x0c78b81d5da49fe7fd13832aac4aba9f79f31d25453b61ed09ec3ce941adca70",
    //     "0x201dc11898ad0213485b4b34b9702beedc8f3bbcc71b2e38512508adb59c8ea9"];
    
    // let orderKeys = ["0xe25fe5f3f09ccf383e000a1011486ea4b66ddf797c30fe4ac70507af94d09ff1"]

    // for (let i = 0; i < 1; i++) {
    //     let info = await getOrderInfo(orderKeys[i]);
    //     let sellOrder = info.order;
        
    //     // console.log("sellOrder: ", sellOrder);
        
    //     let buyOrder = {
    //         side: Side.Bid, // 方向：决定你是买家还是卖家
    //         saleKind: SaleKind.FixedPriceForItem, // 类型：决定交易模式（固定价、拍卖等）
    //         maker: trader.address, // 创建者 谁下的单
    //         nft: sellOrder.nft, // 标的物：交易哪个NFT
    //         price: sellOrder.price, // 价格：多少钱
    //         expiry: sellOrder.expiry, // 有效期：订单多久有效
    //         salt: sellOrder.salt, // 买卖order的salt应该不同？
    //     }
        
    //     let tx = await esDex.connect(trader).matchOrder(sellOrder, buyOrder, { value: toBn("0.002") });
    //     let txRec = await tx.wait();
        
    //     console.log("matchOrder tx: ", tx.hash);
    // }
    
    // 4.2 testMatchOrder  
    // 卖家根据已有的买家挂单，主动匹配交易，发起卖单
    
    // 5. else
    // await withdrawProtocolFee();
    // await testBatchTransferERC721();
}

async function approvalForVault() {
    // 检查是否已授权
    // 允许金库转走自己的NFT
    let isApproved = await testERC721.isApprovedForAll(deployer.address, esVault_address);
    
    if (isApproved) {
        console.log("Already approved");
        return;
    }
    
    let tx = await testERC721.setApprovalForAll(esVault_address, true);
    await tx.wait();
    
    console.log("Approval tx:", tx.hash)
}

async function testMakeOrder(tokenId = 0) {
    let now = parseInt(new Date() / 1000) + 100000
    let salt = 1;
    let nftAddress = erc721_address;
    // let tokenId = 0;
    
    let order = {
        side: Side.List, // list 卖出订单 bid 出价买入订单
        saleKind: SaleKind.FixedPriceForItem,
        maker: deployer.address,
        nft: [tokenId, nftAddress, 1], 
        price: toBn("0.002"),
        expiry: now,
        salt: salt, // 唯一盐值，用户可以创建参数相同的卖单，通过salt确定卖单的唯一性
    }
    
    // 没有salt的问题：
    // 用户创建订单 → 取消订单 → 攻击者重用相同参数提交订单
    // 因为哈希值相同，系统认为"订单已存在"而拒绝
    
    // 有salt的解决方案：
    // 每个订单有唯一salt → 即使参数相同，哈希也不同
    // 可以创建多个相同条件的订单
    
    tx = await esDex.makeOrders([order]);
    txRec = await tx.wait();
    
    console.log(tx.hash);
}

async function testCancelOrder(orderKeys) {
    tx = await esDex.cancelOrders(orderKeys);
    txRec = await tx.wait();
    
    console.log(txRec);
}

async function testMatchOrder() {
    let now = 1734937947;
    let salt = 1;
    let tokenId = 0;
    let nftAddress = erc721_address;
    
    let sellOrder = {
        side: Side.List,
        saleKind: SaleKind.FixedPriceForItem,
        maker: deployer.address,
        nft: [tokenId, nftAddress, 1],
        price: toBn("0.002"),
        expiry: now,
        salt: salt,
    }
    
    // tx = await esDex.makeOrders([sellOrder]);
    // txRec = await tx.wait();
    // console.log("sellOrder tx: ", tx.hash);
    
    // ====
    let buyOrder = {
        side: Side.Bid,
        saleKind: SaleKind.FixedPriceForCollection,
        maker: trader.address,
        nft: [tokenId, nftAddress, 1],
        price: toBn("0.002"),
        expiry: now,
        salt: salt,
    }
    
    tx = await esDex.connect(trader).matchOrder(sellOrder, buyOrder, { value: toBn("0.002") });
    txRec = await tx.wait();
    
    console.log("matchOrder tx: ", txRec.hash);
}

async function testBatchTransferERC721() {
    toAddr = "0x7752A564c941f7145AdF8B50AA2eC975cEf58689"
    nftAddr = "0x3c8ac104dcbf03ae12c9ac80aa830e1b39609e97"
    tokenId = 1159
    asset = [nftAddr, tokenId]
    assets = [asset]
    
    // callStatic（模拟调用，只读）：
    await esVault.callStatic.batchTransferERC721(toAddr, assets);
    // 只是模拟执行，返回结果但不实际执行
    // 用于：1. 测试 2. 预估Gas 3. 验证参数
    
    console.log("tx: ", tx);
}

async function getOrderInfo(orderKey) {
    orderInfo = await esDex.orders(orderKey);
    // console.log("orderInfo: ", orderInfo);
    
    return orderInfo;
}

async function getfillsStat(orderKey) {
    fillStat = await esDex.filledAmount(orderKey);
    // console.log(fillStat);
    
    return fillStat;
}

async function withdrawProtocolFee() {
    await esDex.withdrawETH(deployer.address, toBn("0.00011"), { gasLimit: 100000 });
    
    console.log("WithdrawETH succeed.");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })