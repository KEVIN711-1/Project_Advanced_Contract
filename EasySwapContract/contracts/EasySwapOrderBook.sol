// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import {LibTransferSafeUpgradeable, IERC721} from "./libraries/LibTransferSafeUpgradeable.sol";
import {Price} from "./libraries/RedBlackTreeLibrary.sol";
import {LibOrder, OrderKey} from "./libraries/LibOrder.sol";
import {LibPayInfo} from "./libraries/LibPayInfo.sol";

import {IEasySwapOrderBook} from "./interface/IEasySwapOrderBook.sol";
import {IEasySwapVault} from "./interface/IEasySwapVault.sol";

import {OrderStorage} from "./OrderStorage.sol";
import {OrderValidator} from "./OrderValidator.sol";
import {ProtocolManager} from "./ProtocolManager.sol";

/**
 * @title EasySwapOrderBook
 * @notice NFT订单簿合约，提供订单创建、取消、编辑和匹配功能
 * @dev 支持两种订单类型：
 *      - List（挂单）：卖家将NFT存入金库，等待买家匹配
 *      - Bid（出价）：买家将ETH存入金库，等待卖家接受
 */
contract EasySwapOrderBook is
    IEasySwapOrderBook,
    Initializable,
    ContextUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    OrderStorage,
    ProtocolManager,
    OrderValidator
{
    using LibTransferSafeUpgradeable for address;
    using LibTransferSafeUpgradeable for IERC721;

    /**
     * @notice 订单创建事件
     * @param orderKey 订单唯一标识
     * @param side 订单方向（List挂单/Bid出价）
     * @param saleKind 销售类型
     * @param maker 订单创建者
     * @param nft NFT资产信息
     * @param price 订单价格
     * @param expiry 订单过期时间
     * @param salt 随机盐值
     */
    event LogMake(
        OrderKey orderKey,
        LibOrder.Side indexed side,
        LibOrder.SaleKind indexed saleKind,
        address indexed maker,
        LibOrder.Asset nft,
        Price price,
        uint64 expiry,
        uint64 salt
    );

    /**
     * @notice 订单取消事件
     * @param orderKey 被取消的订单唯一标识
     * @param maker 订单创建者
     */
    event LogCancel(OrderKey indexed orderKey, address indexed maker);

    /**
     * @notice 订单匹配事件
     * @param makeOrderKey 挂单订单唯一标识
     * @param takeOrderKey 出价订单唯一标识
     * @param makeOrder 挂单订单详情
     * @param takeOrder 出价订单详情
     * @param fillPrice 成交价格
     */
    event LogMatch(
        OrderKey indexed makeOrderKey,
        OrderKey indexed takeOrderKey,
        LibOrder.Order makeOrder,
        LibOrder.Order takeOrder,
        uint128 fillPrice
    );

    /**
     * @notice ETH提取事件
     * @param recipient 接收地址
     * @param amount 提取金额
     */
    event LogWithdrawETH(address recipient, uint256 amount);
    
    /**
     * @notice 批量匹配内部错误事件
     * @param offset 错误发生的订单索引
     * @param msg 错误信息
     */
    event BatchMatchInnerError(uint256 offset, bytes msg);
    
    /**
     * @notice 订单跳过事件（订单创建/取消失败时触发）
     * @param orderKey 订单唯一标识
     * @param salt 订单盐值
     */
    event LogSkipOrder(OrderKey orderKey, uint64 salt);

    /**
     * @notice 仅允许通过delegatecall调用的修饰符
     * @dev 用于批量匹配订单时的内部调用
     */
    modifier onlyDelegateCall() {
        _checkDelegateCall();
        _;
    }

    /**
     * @notice 合约自身地址，用于delegatecall检查
     */
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable state-variable-assignment
    address private immutable self = address(this);

    /**
     * @notice EasySwap金库合约地址，用于资产托管
     */
    address private _vault;

    /**
     * @notice 初始化合约
     * @param newProtocolShare 默认协议手续费比例
     * @param newVault EasySwap金库合约地址
     * @param EIP712Name EIP712域名名称
     * @param EIP712Version EIP712版本号
     */
    function initialize(
        uint128 newProtocolShare,
        address newVault,
        string memory EIP712Name,
        string memory EIP712Version
    ) public initializer {
        __EasySwapOrderBook_init(
            newProtocolShare,
            newVault,
            EIP712Name,
            EIP712Version
        );
    }

    /**
     * @notice 订单簿初始化函数（可升级合约初始化链的第一环）
     */
    function __EasySwapOrderBook_init(
        uint128 newProtocolShare,
        address newVault,
        string memory EIP712Name,
        string memory EIP712Version
    ) internal onlyInitializing {
        __EasySwapOrderBook_init_unchained(
            newProtocolShare,
            newVault,
            EIP712Name,
            EIP712Version
        );
    }

    /**
     * @notice 订单簿初始化函数（实际初始化逻辑）
     * @dev 初始化所有继承的合约模块：
     *      - Context: 上下文管理
     *      - Ownable: 所有权管理
     *      - ReentrancyGuard: 重入保护
     *      - Pausable: 暂停功能
     *      - OrderStorage: 订单存储
     *      - ProtocolManager: 协议费用管理
     *      - OrderValidator: 订单验证（EIP712签名验证）
     */
    function __EasySwapOrderBook_init_unchained(
        uint128 newProtocolShare,
        address newVault,
        string memory EIP712Name,
        string memory EIP712Version
    ) internal onlyInitializing {
        __Context_init();
        __Ownable_init(_msgSender());
        __ReentrancyGuard_init();
        __Pausable_init();

        __OrderStorage_init();
        __ProtocolManager_init(newProtocolShare);
        __OrderValidator_init(EIP712Name, EIP712Version);

        setVault(newVault);
    }

    /**
     * @notice 批量创建订单并转移相关资产
     * @dev 业务逻辑说明：
     *      1. List订单（挂单）：需要先授权EasySwapVault合约，创建订单时会将NFT转移到订单池（金库）
     *      2. Bid订单（出价）：需要传入ETH作为出价金额，创建订单时会将ETH转移到订单池（金库）
     * 
     * @dev 订单验证规则：
     *      - order.maker 必须是 msg.sender（只能为自己创建订单）
     *      - order.price 不能为 0
     *      - order.expiry 必须大于当前区块时间戳，或为 0（表示永不过期）
     *      - order.salt 不能为 0
     * 
     * @param newOrders 多个订单结构数据数组
     * @return newOrderKeys 返回订单唯一标识数组，如果某个订单创建失败，对应位置返回空标识
     */
    function makeOrders(
        LibOrder.Order[] calldata newOrders
    )
        external
        payable
        override
        whenNotPaused
        nonReentrant
        returns (OrderKey[] memory newOrderKeys)
    {
        uint256 orderAmount = newOrders.length;
        newOrderKeys = new OrderKey[](orderAmount);

        uint128 ETHAmount; // 累计需要的ETH总金额（仅Bid订单需要）
        for (uint256 i = 0; i < orderAmount; ++i) {
            uint128 buyPrice; // Bid订单的出价金额
            if (newOrders[i].side == LibOrder.Side.Bid) {
                // 计算Bid订单需要的ETH：单价 × 数量
                buyPrice =
                    Price.unwrap(newOrders[i].price) *
                    newOrders[i].nft.amount;
            }

            // 尝试创建订单
            OrderKey newOrderKey = _makeOrderTry(newOrders[i], buyPrice);
            newOrderKeys[i] = newOrderKey;
            if (
                // 如果订单创建成功，累计ETH金额；如果失败，ETH会被退回
                OrderKey.unwrap(newOrderKey) !=
                OrderKey.unwrap(LibOrder.ORDERKEY_SENTINEL)
            ) {
                ETHAmount += buyPrice;
            }
        }

        if (msg.value > ETHAmount) {
            // 如果传入的ETH多于实际需要的金额，退回多余的ETH
            // 如果ETH不足，交易会回滚
            _msgSender().safeTransferETH(msg.value - ETHAmount);
        }
    }

    /**
     * @notice 批量取消订单
     * @dev 业务逻辑：
     *      1. 只有订单创建者可以取消自己的订单
     *      2. 已完全成交的订单无法取消
     *      3. 取消List订单：从金库提取NFT返回给创建者
     *      4. 取消Bid订单：从金库提取未成交部分的ETH返回给创建者
     * 
     * @param orderKeys 要取消的订单唯一标识数组
     * @return successes 返回每个订单的取消结果（true表示成功，false表示失败）
     */
    function cancelOrders(
        OrderKey[] calldata orderKeys
    )
        external
        override
        whenNotPaused
        nonReentrant
        returns (bool[] memory successes)
    {
        successes = new bool[](orderKeys.length);

        for (uint256 i = 0; i < orderKeys.length; ++i) {
            bool success = _cancelOrderTry(orderKeys[i]);
            successes[i] = success;
        }
    }

    /**
     * @notice 批量编辑订单（修改订单价格）
     * @dev 业务逻辑：编辑订单实际上是取消旧订单并创建新订单的过程
     * 
     * @dev 编辑限制：
     *      - newOrder的saleKind、side、maker、nft必须与oldOrderKey对应的订单匹配，否则会被跳过
     *      - 只能修改价格（price）和数量（amount）
     *      - newOrder的expiry和salt可以重新生成
     * 
     * @dev 资产处理：
     *      - List订单：直接更新金库中的订单关联
     *      - Bid订单：如果新价格更高，需要补足差额ETH；如果新价格更低，会退回多余ETH
     * 
     * @param editDetails 编辑详情数组，包含旧订单标识和新订单信息
     * @return newOrderKeys 返回新订单的唯一标识数组，如果编辑失败，对应位置返回空标识
     */
    function editOrders(
        LibOrder.EditDetail[] calldata editDetails
    )
        external
        payable
        override
        whenNotPaused
        nonReentrant
        returns (OrderKey[] memory newOrderKeys)
    {
        newOrderKeys = new OrderKey[](editDetails.length);

        uint256 bidETHAmount; // Bid订单需要补足的ETH总金额
        for (uint256 i = 0; i < editDetails.length; ++i) {
            (OrderKey newOrderKey, uint256 bidPrice) = _editOrderTry(
                editDetails[i].oldOrderKey,
                editDetails[i].newOrder
            );
            bidETHAmount += bidPrice;
            newOrderKeys[i] = newOrderKey;
        }

        if (msg.value > bidETHAmount) {
            // 如果传入的ETH多于实际需要的金额，退回多余的ETH
            _msgSender().safeTransferETH(msg.value - bidETHAmount);
        }
    }

    /**
     * @notice 匹配单个订单（撮合交易）
     * @dev 业务逻辑：
     *      1. 卖家接受出价：sellOrder.maker调用，接受buyOrder（Bid订单）
     *      2. 买家接受挂单：buyOrder.maker调用，接受sellOrder（List订单）
     * 
     * @dev 资产流转：
     *      - NFT从卖家转移到买家
     *      - ETH从买家转移到卖家（扣除协议手续费）
     *      - 协议手续费留在合约中
     * 
     * @param sellOrder 挂单订单（List订单）
     * @param buyOrder 出价订单（Bid订单）
     */
    function matchOrder(
        LibOrder.Order calldata sellOrder,
        LibOrder.Order calldata buyOrder
    ) external payable override whenNotPaused nonReentrant {
        uint256 costValue = _matchOrder(sellOrder, buyOrder, msg.value);
        if (msg.value > costValue) {
            // 如果传入的ETH多于实际需要的金额，退回多余的ETH
            _msgSender().safeTransferETH(msg.value - costValue);
        }
    }

    /**
     * @notice 批量原子性匹配订单（批量撮合交易）
     * @dev 业务逻辑：使用delegatecall实现批量匹配，确保要么全部成功，要么全部失败
     * 
     * @dev 使用场景1：批量购买NFT
     *      使用"有效的sellOrder订单"，构造匹配的buyOrder订单：
     *      - buyOrder.side = Bid
     *      - buyOrder.saleKind = FixedPriceForItem
     *      - buyOrder.maker = msg.sender
     *      - nft和price值与sellOrder相同
     *      - buyOrder.expiry > block.timestamp
     *      - buyOrder.salt != 0
     * 
     * @dev 使用场景2：批量出售NFT
     *      使用"有效的buyOrder订单"，构造匹配的sellOrder订单：
     *      - sellOrder.side = List
     *      - sellOrder.saleKind = FixedPriceForItem
     *      - sellOrder.maker = msg.sender
     *      - nft和price值与buyOrder相同
     *      - sellOrder.expiry > block.timestamp
     *      - sellOrder.salt != 0
     * 
     * @param matchDetails 匹配详情数组，包含要匹配的sellOrder和buyOrder
     * @return successes 返回每个订单的匹配结果（true表示成功，false表示失败）
     */
    /// @custom:oz-upgrades-unsafe-allow delegatecall
    function matchOrders(
        LibOrder.MatchDetail[] calldata matchDetails
    )
        external
        payable
        override
        whenNotPaused
        nonReentrant
        returns (bool[] memory successes)
    {
        successes = new bool[](matchDetails.length);

        uint128 buyETHAmount; // 累计买家已花费的ETH金额

        for (uint256 i = 0; i < matchDetails.length; ++i) {
            LibOrder.MatchDetail calldata matchDetail = matchDetails[i];
            // 使用delegatecall调用内部匹配函数，保持相同的存储上下文
            (bool success, bytes memory data) = address(this).delegatecall(
                abi.encodeWithSignature(
                    "matchOrderWithoutPayback((uint8,uint8,address,(uint256,address,uint96),uint128,uint64,uint64),(uint8,uint8,address,(uint256,address,uint96),uint128,uint64,uint64),uint256)",
                    matchDetail.sellOrder,
                    matchDetail.buyOrder,
                    msg.value - buyETHAmount
                )
            );

            if (success) {
                successes[i] = success;
                if (matchDetail.buyOrder.maker == _msgSender()) {
                    // 如果是买家发起的匹配，累计已花费的ETH
                    uint128 buyPrice;
                    buyPrice = abi.decode(data, (uint128));
                    buyETHAmount += buyPrice;
                }
            } else {
                // 记录批量匹配中的错误
                emit BatchMatchInnerError(i, data);
            }
        }

        if (msg.value > buyETHAmount) {
            // 如果传入的ETH多于实际需要的金额，退回多余的ETH
            _msgSender().safeTransferETH(msg.value - buyETHAmount);
        }
    }

    /**
     * @notice 匹配订单但不退回多余ETH（内部函数，仅用于批量匹配）
     * @dev 此函数只能通过delegatecall调用，用于批量匹配时避免多次退回ETH
     * @param sellOrder 挂单订单
     * @param buyOrder 出价订单
     * @param msgValue 传入的ETH金额
     * @return costValue 实际花费的ETH金额
     */
    function matchOrderWithoutPayback(
        LibOrder.Order calldata sellOrder,
        LibOrder.Order calldata buyOrder,
        uint256 msgValue
    )
        external
        payable
        whenNotPaused
        onlyDelegateCall
        returns (uint128 costValue)
    {
        costValue = _matchOrder(sellOrder, buyOrder, msgValue);
    }

    /**
     * @notice 尝试创建订单（内部函数）
     * @dev 订单验证规则：
     *      1. 只有订单创建者可以创建订单（order.maker == msg.sender）
     *      2. 价格不能为0
     *      3. salt不能为0
     *      4. 过期时间必须大于当前区块时间戳，或为0（永不过期）
     *      5. 订单不能已被取消或完全成交
     * 
     * @dev 资产处理：
     *      - List订单：将NFT存入金库，限制数量为1
     *      - Bid订单：将ETH存入金库，数量不能为0
     * 
     * @param order 要创建的订单
     * @param ETHAmount Bid订单需要的ETH金额（List订单为0）
     * @return newOrderKey 订单唯一标识，如果创建失败返回空标识
     */
    function _makeOrderTry(
        LibOrder.Order calldata order,
        uint128 ETHAmount
    ) internal returns (OrderKey newOrderKey) {
        if (
            order.maker == _msgSender() && // 只有订单创建者可以创建订单
            Price.unwrap(order.price) != 0 && // 价格不能为0
            order.salt != 0 && // salt不能为0
            (order.expiry > block.timestamp || order.expiry == 0) && // 过期时间必须大于当前区块时间戳或为0（永不过期）
            filledAmount[LibOrder.hash(order)] == 0 // 订单不能已被取消或完全成交
        ) {
            newOrderKey = LibOrder.hash(order);

            // 将资产存入金库
            if (order.side == LibOrder.Side.List) {
                if (order.nft.amount != 1) {
                    // List订单限制数量为1
                    return LibOrder.ORDERKEY_SENTINEL;
                }
                // 将NFT存入金库
                IEasySwapVault(_vault).depositNFT(
                    newOrderKey,
                    order.maker,
                    order.nft.collection,
                    order.nft.tokenId
                );
            } else if (order.side == LibOrder.Side.Bid) {
                if (order.nft.amount == 0) {
                    // Bid订单数量不能为0
                    return LibOrder.ORDERKEY_SENTINEL;
                }
                // 将ETH存入金库
                IEasySwapVault(_vault).depositETH{value: uint256(ETHAmount)}(
                    newOrderKey,
                    ETHAmount
                );
            }

            // 将订单添加到订单存储
            _addOrder(order);

            // 发出订单创建事件
            emit LogMake(
                newOrderKey,
                order.side,
                order.saleKind,
                order.maker,
                order.nft,
                order.price,
                order.expiry,
                order.salt
            );
        } else {
            // 订单创建失败，发出跳过事件
            emit LogSkipOrder(LibOrder.hash(order), order.salt);
        }
    }

    /**
     * @notice 尝试取消订单（内部函数）
     * @dev 取消条件：
     *      1. 只有订单创建者可以取消订单
     *      2. 订单必须未完全成交（filledAmount < nft.amount）
     * 
     * @dev 资产处理：
     *      - List订单：从金库提取NFT返回给创建者
     *      - Bid订单：从金库提取未成交部分的ETH返回给创建者
     * 
     * @param orderKey 要取消的订单唯一标识
     * @return success 是否成功取消
     */
    function _cancelOrderTry(
        OrderKey orderKey
    ) internal returns (bool success) {
        LibOrder.Order memory order = orders[orderKey].order;

        if (
            order.maker == _msgSender() &&
            filledAmount[orderKey] < order.nft.amount // 只有未完全成交的订单才能取消
        ) {
            OrderKey orderHash = LibOrder.hash(order);
            // 从订单存储中移除订单
            _removeOrder(order);
            
            // 从金库提取资产
            if (order.side == LibOrder.Side.List) {
                // List订单：提取NFT返回给创建者
                IEasySwapVault(_vault).withdrawNFT(
                    orderHash,
                    order.maker,
                    order.nft.collection,
                    order.nft.tokenId
                );
            } else if (order.side == LibOrder.Side.Bid) {
                // Bid订单：计算未成交数量，提取对应ETH返回给创建者
                uint256 availNFTAmount = order.nft.amount -
                    filledAmount[orderKey];
                IEasySwapVault(_vault).withdrawETH(
                    orderHash,
                    Price.unwrap(order.price) * availNFTAmount, // 提取的ETH金额 = 单价 × 未成交数量
                    order.maker
                );
            }
            // 标记订单为已取消
            _cancelOrder(orderKey);
            success = true;
            emit LogCancel(orderKey, order.maker);
        } else {
            // 取消失败，发出跳过事件
            emit LogSkipOrder(orderKey, order.salt);
        }
    }

    /**
     * @notice 尝试编辑订单（内部函数）
     * @dev 编辑订单实际上是取消旧订单并创建新订单的过程
     * 
     * @dev 编辑限制检查：
     *      1. saleKind、side、maker、nft（collection和tokenId）必须与旧订单匹配
     *      2. 只能修改价格（price）和数量（amount）
     *      3. 订单不能已完全成交
     * 
     * @dev 新订单验证：
     *      1. 新订单的maker必须是调用者
     *      2. salt不能为0
     *      3. 过期时间必须有效（大于当前时间或为0）
     *      4. 新订单不能已被取消或完全成交
     * 
     * @dev 资产处理：
     *      - List订单：直接更新金库中的订单关联
     *      - Bid订单：
     *        * 如果新价格更高：需要补足差额ETH（deltaBidPrice）
     *        * 如果新价格更低：金库会退回多余ETH
     * 
     * @param oldOrderKey 旧订单唯一标识
     * @param newOrder 新订单信息
     * @return newOrderKey 新订单唯一标识，如果编辑失败返回空标识
     * @return deltaBidPrice Bid订单需要补足的ETH金额（如果新价格更高）
     */
    function _editOrderTry(
        OrderKey oldOrderKey,
        LibOrder.Order calldata newOrder
    ) internal returns (OrderKey newOrderKey, uint256 deltaBidPrice) {
        LibOrder.Order memory oldOrder = orders[oldOrderKey].order;

        // 检查订单编辑限制：只能修改价格和数量
        if (
            (oldOrder.saleKind != newOrder.saleKind) ||
            (oldOrder.side != newOrder.side) ||
            (oldOrder.maker != newOrder.maker) ||
            (oldOrder.nft.collection != newOrder.nft.collection) ||
            (oldOrder.nft.tokenId != newOrder.nft.tokenId) ||
            filledAmount[oldOrderKey] >= oldOrder.nft.amount // 订单不能已完全成交
        ) {
            emit LogSkipOrder(oldOrderKey, oldOrder.salt);
            return (LibOrder.ORDERKEY_SENTINEL, 0);
        }

        // 检查新订单是否有效
        if (
            newOrder.maker != _msgSender() ||
            newOrder.salt == 0 ||
            (newOrder.expiry < block.timestamp && newOrder.expiry != 0) ||
            filledAmount[LibOrder.hash(newOrder)] != 0 // 新订单不能已被取消或完全成交
        ) {
            emit LogSkipOrder(oldOrderKey, newOrder.salt);
            return (LibOrder.ORDERKEY_SENTINEL, 0);
        }

        // 取消旧订单
        uint256 oldFilledAmount = filledAmount[oldOrderKey];
        _removeOrder(oldOrder); // 从订单存储中移除
        _cancelOrder(oldOrderKey); // 从订单簿中取消
        emit LogCancel(oldOrderKey, oldOrder.maker);

        // 创建新订单
        newOrderKey = _addOrder(newOrder); // 添加到订单存储

        // 更新金库中的资产关联
        if (oldOrder.side == LibOrder.Side.List) {
            // List订单：直接更新NFT关联
            IEasySwapVault(_vault).editNFT(oldOrderKey, newOrderKey);
        } else if (oldOrder.side == LibOrder.Side.Bid) {
            // Bid订单：计算价格差额并更新ETH关联
            uint256 oldRemainingPrice = Price.unwrap(oldOrder.price) *
                (oldOrder.nft.amount - oldFilledAmount); // 旧订单剩余价格
            uint256 newRemainingPrice = Price.unwrap(newOrder.price) *
                newOrder.nft.amount; // 新订单总价格
            if (newRemainingPrice > oldRemainingPrice) {
                // 新价格更高，需要补足差额
                deltaBidPrice = newRemainingPrice - oldRemainingPrice;
                IEasySwapVault(_vault).editETH{value: uint256(deltaBidPrice)}(
                    oldOrderKey,
                    newOrderKey,
                    oldRemainingPrice,
                    newRemainingPrice,
                    oldOrder.maker
                );
            } else {
                // 新价格更低或相等，金库会退回多余ETH
                IEasySwapVault(_vault).editETH(
                    oldOrderKey,
                    newOrderKey,
                    oldRemainingPrice,
                    newRemainingPrice,
                    oldOrder.maker
                );
            }
        }

        // 发出新订单创建事件
        emit LogMake(
            newOrderKey,
            newOrder.side,
            newOrder.saleKind,
            newOrder.maker,
            newOrder.nft,
            newOrder.price,
            newOrder.expiry,
            newOrder.salt
        );
    }

    /**
     * @notice 匹配订单的核心逻辑（内部函数）
     * @dev 支持两种匹配场景：
     *      1. 卖家接受出价：sellOrder.maker调用，接受buyOrder（Bid订单）
     *      2. 买家接受挂单：buyOrder.maker调用，接受sellOrder（List订单）
     * 
     * @dev 资产流转逻辑：
     *      - NFT：从卖家转移到买家
     *      - ETH：从买家转移到卖家（扣除协议手续费）
     *      - 协议手续费：留在合约中
     * 
     * @param sellOrder 挂单订单（List订单）
     * @param buyOrder 出价订单（Bid订单）
     * @param msgValue 调用者传入的ETH金额
     * @return costValue 实际花费的ETH金额（仅买家接受挂单时返回，卖家接受出价时为0）
     */
    function _matchOrder(
        LibOrder.Order calldata sellOrder,
        LibOrder.Order calldata buyOrder,
        uint256 msgValue
    ) internal returns (uint128 costValue) {
        OrderKey sellOrderKey = LibOrder.hash(sellOrder);
        OrderKey buyOrderKey = LibOrder.hash(buyOrder);
        // 检查订单是否可匹配
        _isMatchAvailable(sellOrder, buyOrder, sellOrderKey, buyOrderKey);

        if (_msgSender() == sellOrder.maker) {
            // 场景1：卖家接受出价（卖家主动匹配买家的Bid订单）
            require(msgValue == 0, "HD: value > 0"); // 卖家接受出价时不需要传入ETH
            bool isSellExist = orders[sellOrderKey].order.maker != address(0); // 检查sellOrder是否存在于订单存储中
            _validateOrder(sellOrder, isSellExist);
            _validateOrder(orders[buyOrderKey].order, false); // 验证buyOrder（Bid订单必须存在于订单存储中）

            uint128 fillPrice = Price.unwrap(buyOrder.price); // 成交价格为Bid订单的价格
            if (isSellExist) {
                // 如果sellOrder存在于订单存储中，移除并标记为完全成交
                _removeOrder(sellOrder);
                _updateFilledAmount(sellOrder.nft.amount, sellOrderKey); // sellOrder完全成交
            }
            // 更新buyOrder的成交数量
            _updateFilledAmount(filledAmount[buyOrderKey] + 1, buyOrderKey);
            
            emit LogMatch(
                sellOrderKey,
                buyOrderKey,
                sellOrder,
                buyOrder,
                fillPrice
            );

            // 资产转移
            // 1. 从金库提取buyOrder的ETH到合约
            IEasySwapVault(_vault).withdrawETH(
                buyOrderKey,
                fillPrice,
                address(this)
            );

            // 2. 计算协议手续费并转给卖家（扣除手续费后的金额）
            uint128 protocolFee = _shareToAmount(fillPrice, protocolShare);
            sellOrder.maker.safeTransferETH(fillPrice - protocolFee);

            // 3. 转移NFT给买家
            if (isSellExist) {
                // 如果sellOrder存在于订单存储中，从金库提取NFT
                IEasySwapVault(_vault).withdrawNFT(
                    sellOrderKey,
                    buyOrder.maker,
                    sellOrder.nft.collection,
                    sellOrder.nft.tokenId
                );
            } else {
                // 如果sellOrder不存在于订单存储中，直接从卖家转移NFT给买家
                IEasySwapVault(_vault).transferERC721(
                    sellOrder.maker,
                    buyOrder.maker,
                    sellOrder.nft
                );
            }
        } else if (_msgSender() == buyOrder.maker) {
            // 场景2：买家接受挂单（买家主动匹配卖家的List订单）
            bool isBuyExist = orders[buyOrderKey].order.maker != address(0); // 检查buyOrder是否存在于订单存储中
            _validateOrder(orders[sellOrderKey].order, false); // 验证sellOrder（List订单必须存在于订单存储中）
            _validateOrder(buyOrder, isBuyExist);

            uint128 buyPrice = Price.unwrap(buyOrder.price); // 买家的出价
            uint128 fillPrice = Price.unwrap(sellOrder.price); // 成交价格为List订单的价格
            if (!isBuyExist) {
                // 如果buyOrder不存在于订单存储中，需要传入足够的ETH
                require(msgValue >= fillPrice, "HD: value < fill price");
            } else {
                // 如果buyOrder存在于订单存储中，验证出价是否足够
                require(buyPrice >= fillPrice, "HD: buy price < fill price");
                // 从金库提取buyOrder的ETH到合约
                IEasySwapVault(_vault).withdrawETH(
                    buyOrderKey,
                    buyPrice,
                    address(this)
                );
                // 移除buyOrder并标记为完全成交
                _removeOrder(buyOrder);
                _updateFilledAmount(filledAmount[buyOrderKey] + 1, buyOrderKey);
            }
            // 标记sellOrder为完全成交
            _updateFilledAmount(sellOrder.nft.amount, sellOrderKey);

            emit LogMatch(
                buyOrderKey,
                sellOrderKey,
                buyOrder,
                sellOrder,
                fillPrice
            );

            // 资产转移
            // 1. 计算协议手续费并转给卖家（扣除手续费后的金额）
            uint128 protocolFee = _shareToAmount(fillPrice, protocolShare);
            sellOrder.maker.safeTransferETH(fillPrice - protocolFee);
            
            // 2. 如果买家出价高于成交价，退回多余ETH
            if (buyPrice > fillPrice) {
                buyOrder.maker.safeTransferETH(buyPrice - fillPrice);
            }

            // 3. 从金库提取NFT给买家
            IEasySwapVault(_vault).withdrawNFT(
                sellOrderKey,
                buyOrder.maker,
                sellOrder.nft.collection,
                sellOrder.nft.tokenId
            );
            
            // 返回实际花费的ETH金额（如果buyOrder已存在于订单存储中，则不需要额外ETH）
            costValue = isBuyExist ? 0 : buyPrice;
        } else {
            revert("HD: sender invalid");
        }
    }

    /**
     * @notice 检查订单是否可匹配（内部函数）
     * @dev 匹配条件：
     *      1. 两个订单不能是同一个订单
     *      2. sellOrder必须是List订单，buyOrder必须是Bid订单
     *      3. sellOrder必须是FixedPriceForItem类型
     *      4. 两个订单的创建者不能是同一人
     *      5. 资产必须匹配：
     *         - buyOrder是FixedPriceForCollection类型（集合出价），或
     *         - 两个订单的collection和tokenId必须相同
     *      6. 两个订单都必须未完全成交
     * 
     * @param sellOrder 挂单订单
     * @param buyOrder 出价订单
     * @param sellOrderKey 挂单订单唯一标识
     * @param buyOrderKey 出价订单唯一标识
     */
    function _isMatchAvailable(
        LibOrder.Order memory sellOrder,
        LibOrder.Order memory buyOrder,
        OrderKey sellOrderKey,
        OrderKey buyOrderKey
    ) internal view {
        require(
            OrderKey.unwrap(sellOrderKey) != OrderKey.unwrap(buyOrderKey),
            "HD: same order"
        );
        require(
            sellOrder.side == LibOrder.Side.List &&
                buyOrder.side == LibOrder.Side.Bid,
            "HD: side mismatch"
        );
        require(
            sellOrder.saleKind == LibOrder.SaleKind.FixedPriceForItem,
            "HD: kind mismatch"
        );
        require(sellOrder.maker != buyOrder.maker, "HD: same maker");
        require( // 检查资产是否匹配
            buyOrder.saleKind == LibOrder.SaleKind.FixedPriceForCollection ||
                (sellOrder.nft.collection == buyOrder.nft.collection &&
                    sellOrder.nft.tokenId == buyOrder.nft.tokenId),
            "HD: asset mismatch"
        );
        require(
            filledAmount[sellOrderKey] < sellOrder.nft.amount &&
                filledAmount[buyOrderKey] < buyOrder.nft.amount,
            "HD: order closed"
        );
    }

    /**
     * @notice 根据手续费比例计算手续费金额
     * @param total 总金额
     * @param share 手续费比例（基点制）
     * @return 计算出的手续费金额
     */
    function _shareToAmount(
        uint128 total,
        uint128 share
    ) internal pure returns (uint128) {
        return (total * share) / LibPayInfo.TOTAL_SHARE;
    }

    /**
     * @notice 检查是否为delegatecall调用
     * @dev 用于批量匹配订单时的安全检查 
     * 这条检查就是防护“直接调用实现合约”，保证逻辑函数只能通过 Proxy 执行，避免状态和权限被绕过。
     */
    function _checkDelegateCall() private view {
        require(address(this) != self);
    }

    /**
     * @notice 设置金库合约地址（仅所有者）
     * @param newVault 新的金库合约地址
     */
    function setVault(address newVault) public onlyOwner {
        require(newVault != address(0), "HD: zero address");
        _vault = newVault;
    }

    /**
     * @notice 提取ETH（仅所有者，用于提取协议手续费）
     * @param recipient 接收地址
     * @param amount 提取金额
     */
    function withdrawETH(
        address recipient,
        uint256 amount
    ) external nonReentrant onlyOwner {
        recipient.safeTransferETH(amount);
        emit LogWithdrawETH(recipient, amount);
    }

    /**
     * @notice 暂停合约（仅所有者）
     * @dev 暂停后所有交易功能将无法使用
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice 恢复合约（仅所有者）
     * @dev 恢复后所有交易功能将重新可用
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice 接收ETH的回退函数
     * @dev 用于接收Bid订单的ETH和协议手续费
     */
    receive() external payable {}

    /**
     * @notice 可升级合约的存储间隙
     * @dev 为未来升级预留存储空间
     */
    uint256[50] private __gap;
}
