const { expect } = require("chai")
const { ethers, upgrades } = require("hardhat")
const { toBn } = require("evm-bn")
const { Side, SaleKind } = require("./common")
const { exp } = require("@prb/math")

// 定义全局变量，在整个测试文件中使用
let owner, addr1, addr2, addrs  // 不同的测试账户：owner是部署者，addr1/addr2是其他测试用户
let esVault, esDex, testERC721, testLibOrder  // 合约实例：Vault金库、OrderBook订单簿、测试NFT、订单库测试合约

// 常用常量定义
const AddressZero = "0x0000000000000000000000000000000000000000";  // 零地址
const Byte32Zero = "0x0000000000000000000000000000000000000000000000000000000000000000";  // 32字节零值
const Uint128Max = toBn("340282366920938463463.374607431768211455");  // 2^128 - 1
const Uint256Max = toBn("115792089237316195423570985008687907853269984665640564039457.584007913129639935");  // 2^256 - 1


describe("EasySwap Test", function () {
    // beforeEach：每个测试用例执行前都会运行这个函数
    // 用于部署合约和初始化测试环境
    beforeEach(async function () {
        // 1. 获取Hardhat提供的测试账户
        // owner: 默认部署者账户
        // addr1, addr2: 其他测试账户
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        // console.log("owner: ", owner.address)

        // 2. 获取合约工厂（用于部署合约）
        esVault = await ethers.getContractFactory("EasySwapVault")  // 金库合约
        esDex = await ethers.getContractFactory("EasySwapOrderBook")  // 订单簿合约
        testERC721 = await ethers.getContractFactory("TestERC721")  // 测试用的ERC721 NFT合约
        testLibOrder = await ethers.getContractFactory("LibOrderTest")  // 订单库测试合约

        // 3. 部署测试用合约
        testLibOrder = await testLibOrder.deploy()  // 部署订单库测试合约
        testERC721 = await testERC721.deploy()      // 部署测试NFT合约
        
        // 4. 部署可升级的Vault合约
        // 使用OpenZeppelin Upgrades插件部署UUPS可升级合约
        esVault = await upgrades.deployProxy(esVault, { initializer: 'initialize' });
        // await esVault.waitForDeployment();
        // console.log("esVault deployed to:", await esVault.getAddress());

        // 5. 部署可升级的OrderBook合约
        newProtocolShare = 200;  // 协议手续费分成比例 2% (200/10000 = 2%)
        newESVault = esVault.address  // 将Vault地址传给OrderBook
        EIP712Name = "EasySwapOrderBook"  // EIP712域名，用于订单签名
        EIP712Version = "1"  // 版本号
        esDex = await upgrades.deployProxy(esDex, 
            [newProtocolShare, newESVault, EIP712Name, EIP712Version], 
            { initializer: 'initialize' }
        );
        // await esDex.waitForDeployment();
        // console.log("esDex deployed to:", await esDex.getAddress());

        // 6. 铸造测试用的NFT
        // 给owner铸造12个NFT（tokenId从0到11）
        nft = testERC721.address
        await testERC721.mint(owner.address, 0)
        await testERC721.mint(owner.address, 1)
        await testERC721.mint(owner.address, 2)
        await testERC721.mint(owner.address, 3)
        await testERC721.mint(owner.address, 4)
        await testERC721.mint(owner.address, 5)
        await testERC721.mint(owner.address, 6)
        await testERC721.mint(owner.address, 7)
        await testERC721.mint(owner.address, 8)
        await testERC721.mint(owner.address, 9)
        await testERC721.mint(owner.address, 10)
        await testERC721.mint(owner.address, 11)
        
        // 7. 授权Vault合约可以操作owner的所有NFT
        // 卖出订单需要将NFT锁定在Vault中
        await testERC721.setApprovalForAll(esVault.address, true)
        // testERC721.setApprovalForAll(esDex.address, true)  // 这行被注释掉了，因为不需要授权给OrderBook

        // 8. 设置Vault和OrderBook的双向绑定关系
        // Vault需要知道哪个OrderBook有权调用它的方法
        await esVault.setOrderBook(esDex.address)
    })

    // ==================== 测试组1: 初始化测试 ====================
    describe("should initialize successfully", async () => {
        it("should initialize successfully", async () => {
            // 测试目的：验证OrderBook合约的EIP712配置是否正确
            // EIP712用于订单的链下签名和链上验证
            
            // 调用合约的eip712Domain()方法获取配置信息
            info = await esDex.eip712Domain();
            
            // 验证域名和版本号是否与部署时设置的一致
            expect(info.name).to.equal(EIP712Name)
            expect(info.version).to.equal(EIP712Version)
        })
    })

    // ==================== 测试组2: 创建订单测试 ====================
    describe("should make order successfully", async () => {
        it("should make list/sell order successfully", async () => {
            // 测试目的：测试创建卖出订单（挂单卖出）的功能
            // 卖出订单需要将NFT锁定到Vault合约中
            
            const now = parseInt(new Date() / 1000) + 100000  // 过期时间：当前时间+100000秒
            const salt = 1;  // 随机数，防止订单哈希碰撞，确保订单唯一性
            const nftAddress = testERC721.address;
            const tokenId = 0;  // 要卖出的NFT的tokenId
            const nftAmount = 1;
            
            // 构建卖出订单对象
            const order = {
                side: Side.List,  // 订单方向：卖出
                saleKind: SaleKind.FixedPriceForItem,  // 销售类型：固定价格单品
                maker: owner.address,  // 订单创建者
                nft: [tokenId, nftAddress, 1],  // NFT信息：[tokenId, 合约地址, 数量]
                price: toBn("0.01"),  // 价格：0.01 ETH
                expiry: now,  // 过期时间戳
                salt: salt,  // 随机数
            }
            const orders = [order];  // 可以批量创建订单，这里只创建一个

            // callStatic：模拟调用但不发送交易，用于获取返回值
            orderKeys = await esDex.callStatic.makeOrders(orders)
            // 验证返回的订单哈希不为空
            expect(orderKeys[0]).to.not.equal(Byte32Zero)

            // tx = await esDex.makeOrders(orders)
            // txRec = await tx.wait()
            // console.log("txRec: ", txRec.logs)

            // 实际执行创建订单交易
            // 预期会触发LogMake事件（订单创建事件）
            await expect(await esDex.makeOrders(orders))
                .to.emit(esDex, "LogMake")

            // 计算订单哈希（用于链上查询）
            const orderHash = await testLibOrder.getOrderHash(order)
            // console.log("orderHash: ", orderHash)

            // 从链上查询订单信息
            dbOrder = await esDex.orders(orderHash)
            // console.log("dbOrder: ", dbOrder)
            // 验证订单创建者是否正确
            expect(dbOrder.order.maker).to.equal(owner.address)
            
            // 验证NFT已经转移到Vault合约（卖出订单需要锁定NFT）
            // 因为NFT在Vault中，确保卖家不能双花
            expect(await testERC721.ownerOf(0)).to.equal(esVault.address)
        })

        it("should make list/sell order and return orders successfully", async () => {
            // 测试目的：简化版的卖出订单测试，只验证订单哈希返回
            // 基本同上，只验证订单哈希不为空
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 0;
            const order = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }
            const orders = [order];

            // 只验证静态调用返回的订单哈希不为空
            orderKeys = await esDex.callStatic.makeOrders(orders)
            expect(orderKeys[0]).to.not.equal(Byte32Zero)

        })

        it("should make bid/buy order successfully", async () => {
            // 测试目的：测试创建买入订单（出价购买）的功能
            // 买入订单需要支付ETH作为保证金，锁定在Vault中
            
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 0;
            
            // 构建买入订单
            const order = {
                side: Side.Bid,  // 订单方向：买入
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],  // 想要买tokenId=0的NFT
                price: toBn("0.01"),  // 出价0.01 ETH
                expiry: now,
                salt: salt,
            }
            const orders = [order];

            // 静态调用：验证订单哈希
            orderKeys = await esDex.callStatic.makeOrders(orders, { value: toBn("0.02") })
            expect(orderKeys[0]).to.not.equal(Byte32Zero)

            // 执行创建订单，验证ETH转账
            // 需要支付price * 数量 = 0.01 * 1 = 0.01 ETH作为保证金
            // 但这里传了0.02 ETH，多余的会被退回吗？不，实际只锁定需要的金额
            await expect(await esDex.makeOrders(orders, { value: toBn("0.02") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.01"), toBn("0.01")]);

            const orderHash = await testLibOrder.getOrderHash(order)
            // console.log("orderHash: ", orderHash)

            // 查询链上订单信息
            dbOrder = await esDex.orders(orderHash)
            // console.log("dbOrder: ", dbOrder)
            expect(dbOrder.order.maker).to.equal(owner.address)
            // 注意：买入订单不需要验证NFT所有权，因为买家没有NFT
        })

        it("should make two side order successfully", async () => {
            // 测试目的：测试同时创建卖出和买入订单
            // 验证一个用户可以同时挂出买单和卖单
            
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 0;
            
            // 卖出订单
            const listOrder = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }

            // 买入订单
            const bidOrder = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }
            const orders = [listOrder, bidOrder];  // 同时创建两个订单

            // 静态调用验证两个订单的哈希都不为空
            orderKeys = await esDex.callStatic.makeOrders(orders, { value: toBn("0.02") })
            expect(orderKeys[0]).to.not.equal(Byte32Zero)
            expect(orderKeys[1]).to.not.equal(Byte32Zero)

            // 执行创建订单，验证ETH转账（只有买单需要支付ETH）
            await expect(await esDex.makeOrders(orders, { value: toBn("0.02") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.01"), toBn("0.01")]);

            // 计算订单哈希
            const listOrderHash = await testLibOrder.getOrderHash(listOrder)
            // 验证卖出订单：NFT被锁定在Vault
            dbOrder = await esDex.orders(listOrderHash)
            expect(dbOrder.order.maker).to.equal(owner.address)
            expect(await testERC721.ownerOf(0)).to.equal(esVault.address)

            // 验证买入订单
            const bidOrderHash = await testLibOrder.getOrderHash(bidOrder)
            dbOrder2 = await esDex.orders(bidOrderHash)
            expect(dbOrder2.order.maker).to.equal(owner.address)
        })
    })

    // ==================== 测试组3: 取消订单测试 ====================
    describe("should cancel order successfully", async () => {
        it("should cancel list order successfully", async () => {
            // 测试目的：测试取消卖出订单
            // 取消后，NFT应该从Vault返还原主
            
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 0;
            const order = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }
            const orders = [order];

            // 1. 先创建订单
            await expect(await esDex.makeOrders(orders))
                .to.emit(esDex, "LogMake")

            const orderHash = await testLibOrder.getOrderHash(order)
            // console.log("orderHash: ", orderHash)

            // 验证订单创建成功
            dbOrder = await esDex.orders(orderHash)
            // console.log("dbOrder: ", dbOrder)
            expect(dbOrder.order.maker).to.equal(owner.address)

            // 2. 静态调用：预估取消订单是否成功
            successes = await esDex.callStatic.cancelOrders([orderHash])
            expect(successes[0]).to.equal(true)

            // tx = await esDex.cancelOrders([orderHash])
            // txRec = await tx.wait()
            // console.log("txRec: ", txRec.logs)

            // 3. 执行取消订单，预期触发LogCancel事件
            await expect(await esDex.cancelOrders([orderHash]))
                .to.emit(esDex, "LogCancel")

            // 4. 验证订单状态：filledAmount被设为Uint256Max，表示已取消
            // 在合约中，filledAmount记录已成交数量，设为最大值表示订单已关闭
            stat = await esDex.filledAmount(orderHash)
            expect(stat).to.equal(Uint256Max)
            
            // 注意：这里没有验证NFT是否返回，但合约逻辑应该会自动返还
        })

        it("should cancel bid order successfully", async () => {
            // 测试目的：测试取消买入订单
            // 取消后，锁定的ETH应该退还给用户
            
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 0;
            
            // 创建买入订单，数量为5个，价格0.01 ETH/个
            const order = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 5],  // 想买5个
                price: toBn("0.01"),  // 总价 = 5 * 0.01 = 0.05 ETH
                expiry: now,
                salt: salt,
            }
            const orders = [order];

            // await expect(await esDex.makeOrders(orders, { value: toBn("0.05") }))
            //     .to.emit(esDex, "LogMake")

            // 1. 创建买入订单，支付0.07 ETH（实际只需要0.05，多余的会被退回？）
            // 合约应该只锁定需要的0.05 ETH
            await expect(await esDex.makeOrders(orders, { value: toBn("0.07") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.05"), toBn("0.05")]);

            const orderHash = await testLibOrder.getOrderHash(order)
            // console.log("orderHash: ", orderHash)

            // 验证订单创建成功
            dbOrder = await esDex.orders(orderHash)
            // console.log("dbOrder: ", dbOrder)
            expect(dbOrder.order.maker).to.equal(owner.address)

            // 2. 静态调用验证取消
            successes = await esDex.callStatic.cancelOrders([orderHash])
            expect(successes[0]).to.equal(true)

            // await expect(await esDex.cancelOrders([orderHash]))
            //     .to.emit(esDex, "LogCancel")

            // 3. 执行取消订单，预期ETH会被退回
            await expect(await esDex.cancelOrders([orderHash]))
                .to.changeEtherBalances([owner, esVault], [toBn("0.05"), toBn("-0.05")]);

            // 4. 验证订单状态为已取消
            stat = await esDex.filledAmount(orderHash)
            expect(stat).to.equal(Uint256Max)
        })

        // 辅助函数：准备一个部分成交的订单
        // 用于测试部分成交后再取消的场景
        async function perparePartlyFilledOrder() {
            // 第一步：addr1创建买入订单，想买4个NFT
            let now = parseInt(new Date() / 1000) + 10000000000  // 很长的过期时间
            let salt = 1;
            let nftAddress = testERC721.address;
            let tokenId = 1;
            let buyOrder = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: addr1.address,
                nft: [tokenId, nftAddress, 4],  // 想买4个tokenId=1的NFT？这里tokenId=1但数量4，可能有问题
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }

            // addr1创建买入订单，支付0.04 ETH保证金
            await expect(await esDex.connect(addr1).makeOrders([buyOrder], { value: toBn("0.04") }))
                .to.emit(esDex, "LogMake")

            const orderHash = await testLibOrder.getOrderHash(buyOrder)
            // console.log("buy orderHash: ", orderHash)

            const dbOrder = await esDex.orders(orderHash)
            // console.log("buy order: ", dbOrder)

            // 第二步：owner卖出1个NFT给addr1
            now = parseInt(new Date() / 1000) + 100000
            salt = 2;
            nftAddress = testERC721.address;
            tokenId = 1;
            sellOrder = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],  // 卖出1个tokenId=1的NFT
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }

            // 匹配订单：owner卖出1个，addr1买入1个
            // 此时addr1的订单还剩3个未成交
            await expect(await esDex.matchOrder(sellOrder, buyOrder))
                .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
            
            // 验证NFT转移给了addr1
            expect(await testERC721.ownerOf(1)).to.equal(addr1.address)
            
            // 返回部分成交的订单哈希
            return orderHash
        }

        it("should cancel bid order partly filled successfully", async () => {
            // 测试目的：测试取消部分成交的买入订单
            // 验证剩余未成交的ETH被正确退还
            
            orderHash = await perparePartlyFilledOrder();  // 准备部分成交的订单
            // console.log("orderHash: ", orderHash)

            // 取消订单
            await expect(await esDex.connect(addr1).cancelOrders([orderHash]))
                .to.emit(esDex, "LogCancel")

            // 验证订单状态为已取消
            stat = await esDex.filledAmount(orderHash)
            expect(stat).to.equal(Uint256Max)

            // 验证剩余ETH（未成交部分的保证金）被退回
            // 原始保证金0.04，成交1个花费0.01，剩余0.03应该退回
            newETHBalance = await esVault.ETHBalance(orderHash);
            expect(newETHBalance).to.equal(toBn("0"))
        })
    })

    // ==================== 测试组4: 修改订单测试 ====================
    describe("should edit orders successfully", async () => {
        it("should edit list orders successfully", async () => {
            // 测试目的：测试修改卖出订单（例如改价格）
            // 修改订单实际上是取消原订单并创建新订单
            
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 1;
            
            // 原订单1：价格0.01
            const order = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }

            // 原订单2：价格0.02
            tokenId2 = 2;
            order2 = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId2, nftAddress, 1],
                price: toBn("0.02"),
                expiry: now,
                salt: salt,
            }
            const orders = [order, order2];

            // 创建两个卖出订单
            await expect(await esDex.makeOrders(orders))
                .to.emit(esDex, "LogMake")

            const orderHash = await testLibOrder.getOrderHash(order)
            // console.log("orderHash: ", orderHash)

            const order2Hash = await testLibOrder.getOrderHash(order2)
            // console.log("order2Hash: ", order2Hash)

            // 验证订单创建成功
            dbOrder = await esDex.orders(orderHash)
            expect(dbOrder.order.maker).to.equal(owner.address)

            dbOrder2 = await esDex.orders(order2Hash)
            expect(dbOrder2.order.maker).to.equal(owner.address)

            // 准备修改后的新订单
            newOrder = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.02"),  // 价格从0.01改为0.02
                expiry: now,
                salt: salt,
            }
            newOrder2 = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId2, nftAddress, 1],
                price: toBn("0.04"),  // 价格从0.02改为0.04
                expiry: now,
                salt: 11,  // 修改随机数，确保新订单哈希不同
            }

            // 定义修改操作：原订单哈希 -> 新订单
            editDetail1 = {
                oldOrderKey: orderHash,
                newOrder: newOrder,
            }
            editDetail2 = {
                oldOrderKey: order2Hash,
                newOrder: newOrder2,
            }

            editDetails = [editDetail1, editDetail2]

            // 静态调用验证新订单哈希
            newOrderKeys = await esDex.callStatic.editOrders(editDetails)
            expect(newOrderKeys[0]).to.not.equal(Byte32Zero)
            expect(newOrderKeys[1]).to.not.equal(Byte32Zero)

            // 测试重复编辑的情况（同一个oldOrderKey出现两次）
            editDetailsSkip = [editDetail1, editDetail1, editDetail2]
            newOrderKeys = await esDex.callStatic.editOrders(editDetailsSkip)
            expect(newOrderKeys[0]).to.not.equal(Byte32Zero)
            expect(newOrderKeys[1]).to.equal(Byte32Zero)  // 第二次编辑同一个订单应该失败
            expect(newOrderKeys[2]).to.not.equal(Byte32Zero)
            
            // 执行修改
            await esDex.editOrders(editDetails)

            // 计算新订单的哈希
            const newOrderHash = await testLibOrder.getOrderHash(newOrder)
            const newOrder2Hash = await testLibOrder.getOrderHash(newOrder2)

            // 验证NFT从原订单转移到新订单
            // 新订单中锁定NFT
            newNFTBalance = await esVault.NFTBalance(newOrderHash);
            expect(newNFTBalance).to.equal(1)
            // 原订单中NFT被释放
            oldNFTBalance = await esVault.NFTBalance(orderHash);
            expect(oldNFTBalance).to.equal(0)

            newNFT2Balance = await esVault.NFTBalance(newOrder2Hash);
            expect(newNFT2Balance).to.equal(2)  // 注意这里为什么是2？可能是数量累加？
            oldNFT2Balance = await esVault.NFTBalance(order2Hash);
            expect(oldNFT2Balance).to.equal(0)

            // 验证原订单被取消（filledAmount = Uint256Max）
            newStat = await esDex.filledAmount(newOrderHash);
            expect(newStat).to.equal(0)
            oldStat = await esDex.filledAmount(orderHash);
            expect(oldStat).to.equal(Uint256Max)

            newStat2 = await esDex.filledAmount(newOrder2Hash);
            expect(newStat2).to.equal(0)
            oldStat2 = await esDex.filledAmount(order2Hash);
            expect(oldStat2).to.equal(Uint256Max)
        })

        it("should edit bid order successfully, all new price > old price", async () => {
            // 测试目的：测试修改买入订单，新价格更高（需要补差价）
            
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 0;
            
            // 原订单1：单价0.01，数量1，总价0.01
            const order1 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }

            // 原订单2：单价0.01，数量1，总价0.01
            tokenId2 = 2;
            const order2 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId2, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }
            const orders = [order1, order2];

            // 创建两个买入订单，支付总保证金0.02 ETH
            await expect(await esDex.makeOrders(orders, { value: toBn("0.04") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.02"), toBn("0.02")]);

            const orderHash = await testLibOrder.getOrderHash(order1)
            // console.log("orderHash: ", orderHash)
            const order2Hash = await testLibOrder.getOrderHash(order2)
            // console.log("order2Hash: ", order2Hash)

            // 验证订单创建成功
            dbOrder = await esDex.orders(orderHash)
            expect(dbOrder.order.maker).to.equal(owner.address)

            dbOrder2 = await esDex.orders(order2Hash)
            expect(dbOrder2.order.maker).to.equal(owner.address)

            // 修改订单：提高价格
            // 新订单1：单价0.02，数量2，总价0.04
            newOrder1 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 2],  // 数量从1改为2
                price: toBn("0.02"),  // 价格从0.01提高到0.02
                expiry: now,
                salt: salt,
            }

            // 新订单2：单价0.03，数量2，总价0.06
            newOrder2 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId2, nftAddress, 2],  // 数量从1改为2
                price: toBn("0.03"),  // 价格从0.01提高到0.03
                expiry: now,
                salt: salt,
            }

            editDetail1 = {
                oldOrderKey: orderHash,
                newOrder: newOrder1
            }
            editDetail2 = {
                oldOrderKey: order2Hash,
                newOrder: newOrder2
            }
            editDetails = [editDetail1, editDetail2]

            // 计算需要补的差价：
            // 订单1: 原保证金0.01，新需要0.04，需补0.03
            // 订单2: 原保证金0.01，新需要0.06，需补0.05
            // 总共需补0.08 ETH
            newOrderKeys = await esDex.callStatic.editOrders(editDetails, { value: toBn("0.09") })
            expect(newOrderKeys[0]).to.not.equal(Byte32Zero)
            expect(newOrderKeys[1]).to.not.equal(Byte32Zero)

            // 执行修改，验证补差价0.08 ETH
            await expect(await esDex.editOrders(editDetails, { value: toBn("0.1") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.08"), toBn("0.08")]);

            // 计算新订单哈希
            const newOrderHash = await testLibOrder.getOrderHash(newOrder1)
            const newOrder2Hash = await testLibOrder.getOrderHash(newOrder2)

            // 验证新订单状态
            newStat = await esDex.filledAmount(newOrderHash);
            expect(newStat).to.equal(0)
            oldStat = await esDex.filledAmount(orderHash);
            expect(oldStat).to.equal(Uint256Max)

            new2Stat = await esDex.filledAmount(newOrder2Hash);
            expect(newStat).to.equal(0)  // 注意：这里应该是new2Stat，但写成了newStat
            old2Stat = await esDex.filledAmount(order2Hash);
            expect(old2Stat).to.equal(Uint256Max)

            // 验证新订单的ETH保证金
            newETHBalance = await esVault.ETHBalance(newOrderHash);
            expect(newETHBalance).to.equal(toBn("0.04"))  // 2 * 0.02 = 0.04
            oldETHBalance = await esVault.ETHBalance(orderHash);
            expect(oldETHBalance).to.equal(0)

            newETHBalance2 = await esVault.ETHBalance(newOrder2Hash);
            expect(newETHBalance2).to.equal(toBn("0.06"))  // 2 * 0.03 = 0.06
            oldETHBalance2 = await esVault.ETHBalance(order2Hash);
            expect(oldETHBalance2).to.equal(0)
        })

        it("should edit bid order successfully, all new price < old price", async () => {
            // 测试目的：测试修改买入订单，新价格更低（退还差价）
            
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 0;
            
            // 原订单1：单价0.01，数量1，总价0.01
            const order1 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }

            // 原订单2：单价0.01，数量1，总价0.01
            tokenId2 = 2
            const order2 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId2, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }
            const orders = [order1, order2];

            // 创建订单，支付0.02 ETH
            await expect(await esDex.makeOrders(orders, { value: toBn("0.04") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.02"), toBn("0.02")]);

            const orderHash = await testLibOrder.getOrderHash(order1)
            // console.log("orderHash: ", orderHash)
            const order2Hash = await testLibOrder.getOrderHash(order2)
            // console.log("order2Hash: ", order2Hash)

            // 验证订单创建成功
            dbOrder = await esDex.orders(orderHash)
            expect(dbOrder.order.maker).to.equal(owner.address)

            dbOrder2 = await esDex.orders(order2Hash)
            expect(dbOrder2.order.maker).to.equal(owner.address)

            // 修改订单：降低价格
            // 新订单1：单价0.005，数量3，总价0.015
            newOrder1 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 3],  // 数量从1改为3
                price: toBn("0.005"),  // 价格从0.01降到0.005
                expiry: now,
                salt: salt,
            }

            // 新订单2：单价0.006，数量5，总价0.03
            newOrder2 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId2, nftAddress, 5],  // 数量从1改为5
                price: toBn("0.006"),  // 价格从0.01降到0.006
                expiry: now,
                salt: salt,
            }

            editDetail1 = {
                oldOrderKey: orderHash,
                newOrder: newOrder1
            }
            editDetail2 = {
                oldOrderKey: order2Hash,
                newOrder: newOrder2
            }
            editDetails = [editDetail1, editDetail2]

            // 计算差价：
            // 订单1: 原保证金0.01，新需要0.015，还需补0.005
            // 订单2: 原保证金0.01，新需要0.03，还需补0.02
            // 总共需补0.025 ETH（实际上价格降低应该退还，但这里数量增加了）
            newOrderKeys = await esDex.callStatic.editOrders(editDetails, { value: toBn("0.04") })
            expect(newOrderKeys[0]).to.not.equal(Byte32Zero)
            expect(newOrderKeys[1]).to.not.equal(Byte32Zero)

            // 执行修改
            await expect(await esDex.editOrders(editDetails, { value: toBn("0.04") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.025"), toBn("0.025")]);

            // 计算新订单哈希
            const newOrderHash = await testLibOrder.getOrderHash(newOrder1)
            const newOrder2Hash = await testLibOrder.getOrderHash(newOrder2)

            // 验证新订单状态
            newStat = await esDex.filledAmount(newOrderHash);
            expect(newStat).to.equal(0)
            oldStat = await esDex.filledAmount(orderHash);
            expect(oldStat).to.equal(Uint256Max)

            new2Stat = await esDex.filledAmount(newOrder2Hash);
            expect(newStat).to.equal(0)  // 注意：应该是new2Stat
            old2Stat = await esDex.filledAmount(order2Hash);
            expect(old2Stat).to.equal(Uint256Max)

            // 验证新订单的ETH保证金
            newETHBalance = await esVault.ETHBalance(newOrderHash);
            expect(newETHBalance).to.equal(toBn("0.015"))  // 3 * 0.005 = 0.015
            oldETHBalance = await esVault.ETHBalance(orderHash);
            expect(oldETHBalance).to.equal(0)

            newETHBalance2 = await esVault.ETHBalance(newOrder2Hash);
            expect(newETHBalance2).to.equal(toBn("0.03"))  // 5 * 0.006 = 0.03
            oldETHBalance2 = await esVault.ETHBalance(order2Hash);
            expect(oldETHBalance2).to.equal(0)
        })

        it("should edit bid order successfully, order one: new price < old price, order two: new price > old price", async () => {
            // 测试目的：测试混合场景 - 一个订单降价，一个订单涨价
            
            const now = parseInt(new Date() / 1000) + 100000
            const salt = 1;
            const nftAddress = testERC721.address;
            const tokenId = 0;
            
            // 原订单1：单价0.01，数量1，总价0.01
            const order1 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }

            // 原订单2：单价0.01，数量1，总价0.01
            tokenId2 = 2
            const order2 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId2, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }
            const orders = [order1, order2];

            // 创建订单，支付0.02 ETH
            await expect(await esDex.makeOrders(orders, { value: toBn("0.04") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.02"), toBn("0.02")]);

            const orderHash = await testLibOrder.getOrderHash(order1)
            // console.log("orderHash: ", orderHash)
            const order2Hash = await testLibOrder.getOrderHash(order2)
            // console.log("order2Hash: ", order2Hash)

            // 验证订单创建成功
            dbOrder = await esDex.orders(orderHash)
            expect(dbOrder.order.maker).to.equal(owner.address)

            dbOrder2 = await esDex.orders(order2Hash)
            expect(dbOrder2.order.maker).to.equal(owner.address)

            // 修改订单：一个涨价，一个降价
            // 新订单1：涨价，单价0.02，数量2，总价0.04
            newOrder1 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 2],  // 数量从1改为2
                price: toBn("0.02"),  // 价格从0.01提高到0.02
                expiry: now,
                salt: salt,
            }

            // 新订单2：降价，单价0.002，数量3，总价0.006
            newOrder2 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId2, nftAddress, 3],  // 数量从1改为3
                price: toBn("0.002"),  // 价格从0.01降到0.002
                expiry: now,
                salt: salt,
            }

            editDetail1 = {
                oldOrderKey: orderHash,
                newOrder: newOrder1
            }
            editDetail2 = {
                oldOrderKey: order2Hash,
                newOrder: newOrder2
            }
            editDetails = [editDetail1, editDetail2]

            // 计算总差价：
            // 订单1: 原保证金0.01，新需要0.04，需补0.03
            // 订单2: 原保证金0.01，新需要0.006，应退0.004
            // 净需补0.026 ETH
            newOrderKeys = await esDex.callStatic.editOrders(editDetails, { value: toBn("0.04") })
            expect(newOrderKeys[0]).to.not.equal(Byte32Zero)
            expect(newOrderKeys[1]).to.not.equal(Byte32Zero)

            // 执行修改
            await expect(await esDex.editOrders(editDetails, { value: toBn("0.04") }))
                .to.changeEtherBalances([owner, esVault], [toBn("-0.026"), toBn("0.026")]);

            // 计算新订单哈希
            const newOrderHash = await testLibOrder.getOrderHash(newOrder1)
            const newOrder2Hash = await testLibOrder.getOrderHash(newOrder2)

            // 验证新订单状态
            newStat = await esDex.filledAmount(newOrderHash);
            expect(newStat).to.equal(0)
            oldStat = await esDex.filledAmount(orderHash);
            expect(oldStat).to.equal(Uint256Max)

            new2Stat = await esDex.filledAmount(newOrder2Hash);
            expect(newStat).to.equal(0)  // 注意：应该是new2Stat
            old2Stat = await esDex.filledAmount(order2Hash);
            expect(old2Stat).to.equal(Uint256Max)

            // 验证新订单的ETH保证金
            newETHBalance = await esVault.ETHBalance(newOrderHash);
            expect(newETHBalance).to.equal(toBn("0.04"))  // 2 * 0.02 = 0.04
            oldETHBalance = await esVault.ETHBalance(orderHash);
            expect(oldETHBalance).to.equal(0)

            newETHBalance2 = await esVault.ETHBalance(newOrder2Hash);
            expect(newETHBalance2).to.equal(toBn("0.006"))  // 3 * 0.002 = 0.006
            oldETHBalance2 = await esVault.ETHBalance(order2Hash);
            expect(oldETHBalance2).to.equal(0)
        })
    })

    // ==================== 测试组5: 订单匹配测试 ====================
    describe("should match order successfully", async () => {
        describe("should check match available successfully", async () => {
            it("should match list order successfully", async () => {
                // 测试目的：测试卖出订单被买入订单匹配（正常的买卖流程）
                
                // 第一步：owner创建卖出订单
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // 第二步：addr1创建买入订单并匹配
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                // 执行匹配订单，验证资金流向：
                // esDex获得手续费0.0002 (2% of 0.01)
                // owner获得0.0098 (0.01 - 0.0002)
                // addr1支付0.01 ETH
                await expect(await esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.03") }))
                    .to.changeEtherBalances([esDex, owner, addr1], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                
                // 验证NFT转移给了addr1
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)

                // tx = await esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") })
                // txRec = await tx.wait()
                // console.log("txRec: ", txRec.logs)
                // console.log("gasUsed: ", txRec.gasUsed.toString())
            });

            it("should match collection bid order successfully", async () => {
                // 测试目的：测试合集买入订单被多个卖出订单匹配
                // 合集买单可以买该合集下的任意NFT
                
                // 第一步：addr1创建合集买单
                let now = parseInt(new Date() / 1000) + 10000000000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 1;
                let buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForCollection,  // 合集买单
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 4],  // 想买4个该合集下的NFT
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                // addr1创建合集买单，支付0.04 ETH保证金
                await expect(await esDex.connect(addr1).makeOrders([buyOrder], { value: toBn("0.04") }))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(buyOrder)
                // console.log("buy orderHash: ", orderHash)

                const dbOrder = await esDex.orders(orderHash)
                // console.log("buy order: ", dbOrder)

                // 第二步：依次匹配4个不同的卖出订单（不同tokenId）
                // 匹配第1个
                { 
                    now = parseInt(new Date() / 1000) + 100000
                    salt = 2;
                    nftAddress = testERC721.address;
                    tokenId = 1;
                    sellOrder = {
                        side: Side.List,
                        saleKind: SaleKind.FixedPriceForItem,
                        maker: owner.address,
                        nft: [tokenId, nftAddress, 1],
                        price: toBn("0.01"),
                        expiry: now,
                        salt: salt,
                    }

                    await expect(await esDex.matchOrder(sellOrder, buyOrder))
                        .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                    expect(await testERC721.ownerOf(1)).to.equal(addr1.address)

                    // 验证订单已成交数量
                    newStat = await esDex.filledAmount(orderHash);
                    expect(newStat).to.equal(1)

                    // 验证剩余保证金
                    newETHBalance = await esVault.ETHBalance(orderHash);
                    expect(newETHBalance).to.equal(toBn("0.03"))
                }

                // 匹配第2个
                {
                    now = parseInt(new Date() / 1000) + 100000
                    salt = 2;
                    nftAddress = testERC721.address;
                    tokenId = 2;
                    sellOrder = {
                        side: Side.List,
                        saleKind: SaleKind.FixedPriceForItem,
                        maker: owner.address,
                        nft: [tokenId, nftAddress, 1],
                        price: toBn("0.01"),
                        expiry: now,
                        salt: salt,
                    }

                    await expect(await esDex.matchOrder(sellOrder, buyOrder))
                        .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                    expect(await testERC721.ownerOf(1)).to.equal(addr1.address)  // 注意：这里验证的是tokenId=1，但卖出的是tokenId=2

                    newStat = await esDex.filledAmount(orderHash);
                    expect(newStat).to.equal(2)

                    newETHBalance = await esVault.ETHBalance(orderHash);
                    expect(newETHBalance).to.equal(toBn("0.02"))
                }

                // 匹配第3个
                {
                    now = parseInt(new Date() / 1000) + 100000
                    salt = 2;
                    nftAddress = testERC721.address;
                    tokenId = 3;
                    sellOrder = {
                        side: Side.List,
                        saleKind: SaleKind.FixedPriceForItem,
                        maker: owner.address,
                        nft: [tokenId, nftAddress, 1],
                        price: toBn("0.01"),
                        expiry: now,
                        salt: salt,
                    }

                    await expect(await esDex.matchOrder(sellOrder, buyOrder))
                        .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                    expect(await testERC721.ownerOf(1)).to.equal(addr1.address)  // 同样的问题

                    newStat = await esDex.filledAmount(orderHash);
                    expect(newStat).to.equal(3)

                    newETHBalance = await esVault.ETHBalance(orderHash);
                    expect(newETHBalance).to.equal(toBn("0.01"))
                }

                // 匹配第4个
                { 
                    now = parseInt(new Date() / 1000) + 100000
                    salt = 2;
                    nftAddress = testERC721.address;
                    tokenId = 4;
                    sellOrder = {
                        side: Side.List,
                        saleKind: SaleKind.FixedPriceForItem,
                        maker: owner.address,
                        nft: [tokenId, nftAddress, 1],
                        price: toBn("0.01"),
                        expiry: now,
                        salt: salt,
                    }

                    await expect(await esDex.matchOrder(sellOrder, buyOrder))
                        .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                    expect(await testERC721.ownerOf(1)).to.equal(addr1.address)  // 同样的问题

                    newStat = await esDex.filledAmount(orderHash);
                    expect(newStat).to.equal(4)  // 订单已满

                    newETHBalance = await esVault.ETHBalance(orderHash);
                    expect(newETHBalance).to.equal(toBn("0"))  // 保证金用完
                }

                // 尝试匹配第5个，应该失败（订单已满）
                {
                    now = parseInt(new Date() / 1000) + 100000
                    salt = 2;
                    nftAddress = testERC721.address;
                    tokenId = 5;
                    sellOrder = {
                        side: Side.List,
                        saleKind: SaleKind.FixedPriceForItem,
                        maker: owner.address,
                        nft: [tokenId, nftAddress, 1],
                        price: toBn("0.01"),
                        expiry: now,
                        salt: salt,
                    }

                    await expect(esDex.matchOrder(sellOrder, buyOrder))
                        .to.be.revertedWith("HD: order closed")
                }
            });

            it("should match item bid order successfully", async () => {
                // 测试目的：测试单品买入订单被卖出订单匹配
                // 单品买单只能买指定tokenId的NFT
                
                // addr1创建单品买单
                let now = parseInt(new Date() / 1000) + 10000000000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,  // 单品买单
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],  // 指定买tokenId=0
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.connect(addr1).makeOrders([buyOrder], { value: toBn("0.01") }))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(buyOrder)
                // console.log("buy orderHash: ", orderHash)

                const dbOrder = await esDex.orders(orderHash)
                // console.log("buy order: ", dbOrder)

                // owner创建卖出订单并匹配
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                sellOrder = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.matchOrder(sellOrder, buyOrder))
                    .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                
                // 验证NFT转移
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)

                // tx = await esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") })
                // txRec = await tx.wait()
                // console.log("txRec: ", txRec.events)
                // console.log("gasUsed: ", txRec.gasUsed.toString())
            });

            it("should revert if order is the same", async () => {
                // 测试目的：不能匹配相同的订单（自己匹配自己）
                
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // 尝试用相同的订单匹配自己应该失败
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                buyOrder = {
                    side: Side.List,  // 错误：应该是Bid
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") })).to.be.revertedWith("HD: same order")
            });

            it("should revert if side mismatch", async () => {
                // 测试目的：订单方向不匹配（两个都是卖出）
                
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,  // 卖出
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // 另一个卖出订单作为买单尝试匹配
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                buyOrder = {
                    side: Side.List,  // 应该是Bid，但这里用了List
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.02"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") })).to.be.revertedWith("HD: side mismatch")
            });

            it("should revert if sale kind mismatch", async () => {
                // 测试目的：销售类型不匹配（合集卖 vs 单品买）
                
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForCollection,  // 合集卖出
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // 用单品买单尝试匹配
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForCollection,  // 合集买入
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.02"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") })).to.be.revertedWith("HD: kind mismatch")
            });

            it("should revert if list order's sale kind is for collection", async () => {
                // 测试目的：合集卖出订单不能匹配单品买入订单
                
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForCollection,  // 合集卖出
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // 用单品买单尝试匹配
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,  // 单品买入
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.02"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") })).to.be.revertedWith("HD: kind mismatch")
                // await expect(await esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") }))
                //     .to.changeEtherBalances([esDex, owner, addr1], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                // expect(await testERC721.ownerOf(0)).to.equal(addr1.address)

            });

            it("should revert if asset mismatch", async () => {
                // 测试目的：资产不匹配（不同的tokenId）
                
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],  // tokenId = 0
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // 买单指定了不同的tokenId
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 1;
                buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],  // tokenId = 1
                    price: toBn("0.02"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") })).to.be.revertedWith("HD: asset mismatch")
            });

            it("should revert if order was canceled", async () => {
                // 测试目的：尝试匹配已取消的订单
                
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // 取消订单
                await expect(await esDex.cancelOrders([orderHash]))
                    .to.emit(esDex, "LogCancel")

                // 尝试匹配已取消的订单
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.02"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.01") })).to.be.revertedWith("HD: order closed")
            });

            it("should revert if list order was filled", async () => {
                // 测试目的：尝试匹配已完全成交的卖出订单
                
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // 第一次匹配，订单成交
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.03") }))
                    .to.changeEtherBalances([esDex, owner, addr1], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)

                // 第二次尝试匹配同一订单，应该失败
                await expect(esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("0.03") })).to.be.revertedWith("HD: order closed")
            });

            it("should revert if bid order was filled", async () => {
                // 测试目的：尝试匹配已完全成交的买入订单
                
                let now = parseInt(new Date() / 1000) + 10000000000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForCollection,  // 合集买单
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 2],  // 想买2个
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                // addr1创建买单，支付0.02 ETH
                await expect(await esDex.connect(addr1).makeOrders([buyOrder], { value: toBn("0.02") }))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(buyOrder)
                // console.log("buy orderHash: ", orderHash)

                const dbOrder = await esDex.orders(orderHash)
                // console.log("buy order: ", dbOrder)

                // 第一次匹配，卖出第1个
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                sellOrder = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.matchOrder(sellOrder, buyOrder))
                    .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)

                // 第二次匹配，卖出第2个
                tokenId = 1;
                sellOrder2 = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }
                await expect(await esDex.matchOrder(sellOrder2, buyOrder))
                    .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                expect(await testERC721.ownerOf(tokenId)).to.equal(addr1.address)

                // 第三次尝试匹配，应该失败（订单已满）
                await expect(esDex.matchOrder(sellOrder2, buyOrder)).to.be.revertedWith("HD: order closed")
            });
        })

        describe("should check match successfully if msg.sender is sellOrder.maker", async () => {
            // 测试目的：测试当发送者是卖出订单创建者时的匹配场景（即卖家主动接受买单）
            
            let bidOrder;

            beforeEach(async function () {
                // 准备一个买单供测试
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 2;
                let nftAddress = testERC721.address;
                let tokenId = 1;
                bidOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForCollection,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                orders = [bidOrder]
                // addr1创建买单
                await expect(await esDex.connect(addr1).makeOrders(orders, { value: toBn("0.02") }))
                    .to.changeEtherBalances([addr1, esVault], [toBn("-0.01"), toBn("0.01")]);

                const orderHash = await testLibOrder.getOrderHash(bidOrder)
                // console.log("orderHash: ", orderHash)

            })

            it("should match order successfully", async () => {
                // 卖家（owner）接受addr1的买单
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                // 验证NFT初始属于owner
                expect(await testERC721.ownerOf(0)).to.equal(owner.address)
                
                // owner创建卖出订单并立即匹配addr1的买单
                await expect(await esDex.connect(owner).matchOrder(order, bidOrder))
                    .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                
                // NFT从owner转移到addr1
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)
            })

            it("should match order with exist list order successfully", async () => {
                // 测试目的：卖家已经有现成的卖单，然后接受买单
                
                // 先创建卖单
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                orders = [order]
                await esDex.makeOrders(orders);

                // 验证NFT已锁定在Vault
                expect(await testERC721.ownerOf(0)).to.equal(esVault.address)
                
                // 卖家接受买单
                await expect(await esDex.connect(owner).matchOrder(order, bidOrder))
                    .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                
                // NFT转移给买家
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)
            })

            it("should revert if msgValue > 0", async () => {
                // 卖家接受买单时不应该再支付ETH（因为买家已经支付了）
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(owner).matchOrder(order, bidOrder, { value: toBn("0.01") }))
                    .to.be.revertedWith("HD: value > 0")
            })

            it("should revert if maker is zero", async () => {
                // 验证订单创建者不能是零地址
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: AddressZero,  // 零地址
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(owner).matchOrder(order, bidOrder))
                    .to.be.revertedWith("HD: sender invalid")
            })

            it("should revert if salt = 0", async () => {
                // 验证随机数不能为0
                now = parseInt(new Date() / 1000) + 100000;
                salt = 0;  // salt为0
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(owner).matchOrder(order, bidOrder))
                    .to.be.revertedWith("OVa: zero salt")
            })

            it("should revert if unsupported nft asset", async () => {
                // 验证NFT地址不能为零
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, AddressZero, 1],  // NFT地址为0
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(owner).matchOrder(order, bidOrder))
                    .to.be.revertedWith("OVa: unsupported nft asset")
            })

            it.skip("should revert if buy price < sell price", async () => {
                // 这个测试被跳过了，可能因为逻辑需要调整
                // accept bid 
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.02"),  // 卖价0.02
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(owner).matchOrder(order, bidOrder))
                    .to.be.revertedWith("HD: buy price < fill price")  // 买价0.01 < 卖价0.02
            })
        })

        describe("should check match successfully if msg.sender is buyOrder.maker", async () => {
            // 测试目的：测试当发送者是买入订单创建者时的匹配场景（即买家主动接受卖单）
            
            let listOrder;

            beforeEach(async function () {
                // 准备一个卖单供测试
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 2;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                listOrder = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                orders = [listOrder]
                // owner创建卖单
                await esDex.connect(owner).makeOrders(orders)

                const orderHash = await testLibOrder.getOrderHash(listOrder)
                // console.log("orderHash: ", orderHash)
            })

            it("should match order successfully", async () => {
                // 买家（addr1）接受owner的卖单
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                // 验证NFT在Vault中
                expect(await testERC721.ownerOf(0)).to.equal(esVault.address)
                
                // addr1创建买单并立即匹配owner的卖单
                await expect(await esDex.connect(addr1).matchOrder(listOrder, order, { value: toBn("0.01") }))
                    .to.changeEtherBalances([esDex, owner, addr1], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                
                // NFT转移给addr1
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)
            })

            it("should match order with exist bid order successfully", async () => {
                // 测试目的：买家已经有现成的买单，然后接受卖单
                
                // 先创建买单
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }
                orders = [order]

                // addr1创建买单，支付0.01 ETH
                await expect(await esDex.connect(addr1).makeOrders(orders, { value: toBn("0.04") }))
                    .to.changeEtherBalances([addr1, esVault], [toBn("-0.01"), toBn("0.01")]);

                // 验证NFT在Vault中
                expect(await testERC721.ownerOf(0)).to.equal(esVault.address)
                
                // 买家接受卖单（使用已有的买单）
                await expect(await esDex.connect(addr1).matchOrder(listOrder, order))
                    .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0002"), toBn("0.0098"), toBn("-0.01")]);
                
                // NFT转移给买家
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)
            })

            it("should revert if maker is zero", async () => {
                // 验证订单创建者不能是零地址
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: AddressZero,  // 零地址
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(listOrder, order))
                    .to.be.revertedWith("HD: sender invalid")
            })

            it("should revert if salt = 0", async () => {
                // 验证随机数不能为0
                now = parseInt(new Date() / 1000) + 100000;
                salt = 0;  // salt为0
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(listOrder, order))
                    .to.be.revertedWith("OVa: zero salt")
            })

            it("should revert if unsupported nft asset", async () => {
                // 验证资产不匹配（不同的tokenId）
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 1;  // tokenId=1，但卖单是tokenId=0
                let order = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.01"),
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(listOrder, order))
                    .to.be.revertedWith("HD: asset mismatch")
            })

            it("should revert if value < sell price", async () => {
                // 验证支付金额不足
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.02"),  // 出价0.02，但卖价是0.01，实际上金额是够的
                    expiry: now,
                    salt: salt,
                }

                await expect(esDex.connect(addr1).matchOrder(listOrder, order))
                    .to.be.revertedWith("HD: value < fill price")  // 这个revert信息可能不太准确
            })

            it("should revert if buy price < sell price", async () => {
                // 验证买价不能低于卖价
                now = parseInt(new Date() / 1000) + 100000;
                salt = 1;
                nftAddress = testERC721.address;
                tokenId = 0;
                let order = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("0.002"),  // 买价0.002 < 卖价0.01
                    expiry: now,
                    salt: salt,
                }

                orders = [order]

                // 创建买单
                await expect(await esDex.connect(addr1).makeOrders(orders, { value: toBn("0.004") }))
                    .to.changeEtherBalances([addr1, esVault], [toBn("-0.002"), toBn("0.002")]);

                // 尝试匹配，应该失败
                await expect(esDex.connect(addr1).matchOrder(listOrder, order))
                    .to.be.revertedWith("HD: buy price < fill price")
            })
        })
    })

    // ==================== 测试组6: 批量匹配测试 ====================
    describe("should match orders successfully", async () => {
        it("should match list orders successfully", async () => {
            // 测试目的：批量匹配多个卖出订单
            
            let now = parseInt(new Date() / 1000) + 100000
            let salt = 1;
            let nftAddress = testERC721.address;
            
            // 创建两个卖出订单
            // 卖出订单1: tokenId=0
            let order = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [0, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }
            await expect(await esDex.makeOrders([order]))
                .to.emit(esDex, "LogMake")

            const orderHash = await testLibOrder.getOrderHash(order)
            // console.log("orderHash: ", orderHash)

            // 卖出订单2: tokenId=1
            now = parseInt(new Date() / 1000) + 100000
            salt = 1;
            nftAddress = testERC721.address;
            tokenId = 1;
            order2 = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.01"),
                expiry: now,
                salt: salt,
            }

            await expect(await esDex.makeOrders([order2]))
                .to.emit(esDex, "LogMake")

            // 创建两个对应的买单
            now = parseInt(new Date() / 1000) + 100000
            salt = 2;
            nftAddress = testERC721.address;
            tokenId = 0;
            // 买单1
            buyOrder = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: addr1.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.02"),  // 出价高于卖价
                expiry: now,
                salt: salt,
            }

            tokenId = 1;
            // 买单2
            buyOrder2 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForItem,
                maker: addr1.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.02"),
                expiry: now,
                salt: salt,
            }

            // 定义批量匹配详情
            matchDetail1 = {
                sellOrder: order,
                buyOrder: buyOrder,
            }
            matchDetail2 = {
                sellOrder: order2,
                buyOrder: buyOrder2,
            }
            matchDetails = [matchDetail1, matchDetail2]

            // 静态调用验证
            successes = await esDex.connect(addr1).callStatic.matchOrders(matchDetails, { value: toBn("0.06") })
            expect(successes[0]).to.equal(true)
            expect(successes[1]).to.equal(true)

            // 执行批量匹配
            await expect(await esDex.connect(addr1).matchOrders(matchDetails, { value: toBn("0.06") }))
                .to.changeEtherBalances([esDex, owner, addr1], [toBn("0.0004"), toBn("0.0196"), toBn("-0.02")]);

            // 验证NFT转移
            expect(await testERC721.ownerOf(0)).to.equal(addr1.address)
            expect(await testERC721.ownerOf(1)).to.equal(addr1.address)
        });

        it("should match bid orders successfully", async () => {
            // 测试目的：批量匹配多个买入订单
            
            let now = parseInt(new Date() / 1000) + 10000000000
            let salt = 1;
            let nftAddress = testERC721.address;
            let tokenId = 0;
            // 创建两个买入订单
            let buyOrder = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForCollection,  // 合集买单
                maker: addr1.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.02"),
                expiry: now,
                salt: salt,
            }

            const orderHash = await testLibOrder.getOrderHash(buyOrder)
            // console.log("orderHash: ", orderHash)

            now = parseInt(new Date() / 1000) + 100000
            salt = 1;
            nftAddress = testERC721.address;
            tokenId = 0;
            let buyOrder2 = {
                side: Side.Bid,
                saleKind: SaleKind.FixedPriceForCollection,
                maker: addr1.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.02"),
                expiry: now,
                salt: salt,
            }

            // addr1创建两个买单，支付0.04 ETH
            await expect(await esDex.connect(addr1).makeOrders([buyOrder, buyOrder2], { value: toBn("0.04") }))
                .to.emit(esDex, "LogMake")

            // 创建两个对应的卖出订单
            now = parseInt(new Date() / 1000) + 100000
            salt = 2;
            nftAddress = testERC721.address;
            tokenId = 1;
            // 卖单1
            sellOrder = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.02"),
                expiry: now,
                salt: salt,
            }

            tokenId = 2;
            // 卖单2
            sellOrder2 = {
                side: Side.List,
                saleKind: SaleKind.FixedPriceForItem,
                maker: owner.address,
                nft: [tokenId, nftAddress, 1],
                price: toBn("0.02"),
                expiry: now,
                salt: salt,
            }

            // 定义批量匹配详情
            matchDetail1 = {
                sellOrder: sellOrder,
                buyOrder: buyOrder,
            }
            matchDetail2 = {
                sellOrder: sellOrder2,
                buyOrder: buyOrder2,
            }
            matchDetails = [matchDetail1, matchDetail2]

            // 静态调用验证
            successes = await esDex.callStatic.matchOrders(matchDetails)
            // console.log("successes: ", successes)
            expect(successes[0]).to.equal(true)
            expect(successes[1]).to.equal(true)

            // 执行批量匹配
            await expect(await esDex.matchOrders(matchDetails))
                .to.changeEtherBalances([esDex, owner, esVault], [toBn("0.0008"), toBn("0.0392"), toBn("-0.04")]);

            // 验证NFT转移
            expect(await testERC721.ownerOf(1)).to.equal(addr1.address)
            expect(await testERC721.ownerOf(2)).to.equal(addr1.address)
        });
    })

    // ==================== 测试组7: NFT转账测试 ====================
    describe("should transfer nft successfully", async () => {
        it("should transfer erc721 successfully", async () => {
            // 测试目的：测试Vault合约的批量转账功能
            // 验证Vault可以批量转移NFT
            
            // 初始状态：NFT属于owner
            expect(await testERC721.ownerOf(0)).to.equal(owner.address)
            expect(await testERC721.ownerOf(1)).to.equal(owner.address)

            // 准备转账
            to = addr1.address
            asset1 = [testERC721.address, 0]  // [合约地址, tokenId]
            asset2 = [testERC721.address, 1]
            assets = [asset1, asset2]

            // 执行批量转账
            await esVault.batchTransferERC721(to, assets)
            
            // 验证所有权转移
            expect(await testERC721.ownerOf(0)).to.equal(addr1.address)
            expect(await testERC721.ownerOf(1)).to.equal(addr1.address)
        });
    })

    // ==================== 测试组8: ETH提现测试 ====================
    describe("withdraw ETH", async () => {
        it("should withdraw ETH successfully", async () => {
            // 测试目的：测试从OrderBook提取手续费
            // 管理员可以提取累积的手续费
            
            // 先进行一次交易产生手续费
            {
                let now = parseInt(new Date() / 1000) + 100000
                let salt = 1;
                let nftAddress = testERC721.address;
                let tokenId = 0;
                let order = {
                    side: Side.List,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: owner.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("1"),  // 1 ETH
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.makeOrders([order]))
                    .to.emit(esDex, "LogMake")

                const orderHash = await testLibOrder.getOrderHash(order)
                // console.log("orderHash: ", orderHash)

                // addr1买入，产生手续费 2% = 0.02 ETH
                now = parseInt(new Date() / 1000) + 100000
                salt = 2;
                nftAddress = testERC721.address;
                tokenId = 0;
                buyOrder = {
                    side: Side.Bid,
                    saleKind: SaleKind.FixedPriceForItem,
                    maker: addr1.address,
                    nft: [tokenId, nftAddress, 1],
                    price: toBn("2"),  // 出价2 ETH
                    expiry: now,
                    salt: salt,
                }

                await expect(await esDex.connect(addr1).matchOrder(order, buyOrder, { value: toBn("3") }))
                    .to.changeEtherBalances([esDex, owner, addr1], [toBn("0.02"), toBn("0.98"), toBn("-1")]);
                expect(await testERC721.ownerOf(0)).to.equal(addr1.address)
            }

            // 提取手续费到owner账户
            await expect(await esDex.withdrawETH(owner.address, toBn("0.02")))
                .to.changeEtherBalances([esDex, owner], [toBn("-0.02"), toBn("0.02")])
        })
    })
})