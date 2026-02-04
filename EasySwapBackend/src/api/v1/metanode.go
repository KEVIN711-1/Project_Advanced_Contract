package v1

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/ProjectsTask/EasySwapBase/errcode"
	"github.com/ProjectsTask/EasySwapBase/logger/xzap"
	"github.com/ProjectsTask/EasySwapBase/xhttp"

	"github.com/ProjectsTask/EasySwapBackend/src/service/svc"
	"github.com/ProjectsTask/EasySwapBackend/src/service/v1"
	"github.com/ProjectsTask/EasySwapBackend/src/types/v1"
)

// MetaNodeMintHandler MetaNodeNFT单个铸造接口
func MetaNodeMintHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 解析请求参数
		var req types.MetaNodeMintRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			xzap.WithContext(c).Error("invalid request parameters", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Invalid request parameters"))
			return
		}

		// 验证链ID
		if req.ChainID <= 0 {
			xhttp.Error(c, errcode.NewCustomErr("Invalid chain_id"))
			return
		}

		// 验证接收地址
		if req.ToAddress == "" {
			xhttp.Error(c, errcode.NewCustomErr("to_address is required"))
			return
		}

		// 验证TokenURI
		if req.TokenURI == "" {
			xhttp.Error(c, errcode.NewCustomErr("token_uri is required"))
			return
		}

		// 调用铸造服务
		result, err := service.MintMetaNodeNFT(c.Request.Context(), svcCtx, &req)
		if err != nil {
			xzap.WithContext(c).Error("failed to mint MetaNodeNFT", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Failed to mint NFT: "+err.Error()))
			return
		}

		// 构建响应
		response := &types.MetaNodeMintResponse{
			Result:        result,
			TransactionID: result.TxHash,
			TokenID:       result.TokenID,
			ContractAddr:  getContractAddress(svcCtx, req.ChainID),
			Message:       "MetaNodeNFT minted successfully",
		}

		xzap.WithContext(c).Info("MetaNodeNFT minted successfully",
			zap.String("tx_hash", result.TxHash),
			zap.String("token_id", result.TokenID),
			zap.String("to_address", req.ToAddress),
		)

		xhttp.OkJson(c, response)
	}
}

// MetaNodeBatchMintHandler MetaNodeNFT批量铸造接口
func MetaNodeBatchMintHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 解析请求参数
		var req types.MetaNodeBatchMintRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			xzap.WithContext(c).Error("invalid batch mint request parameters", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Invalid request parameters"))
			return
		}

		// 验证链ID
		if req.ChainID <= 0 {
			xhttp.Error(c, errcode.NewCustomErr("Invalid chain_id"))
			return
		}

		// 验证批量请求
		if len(req.Mints) == 0 {
			xhttp.Error(c, errcode.NewCustomErr("No mint requests provided"))
			return
		}

		if len(req.Mints) > 50 {
			xhttp.Error(c, errcode.NewCustomErr("Too many mint requests, maximum 50 allowed"))
			return
		}

		// 验证每个铸造请求
		for i, mint := range req.Mints {
			if mint.ToAddress == "" {
				xhttp.Error(c, errcode.NewCustomErr("to_address is required for mint #"+strconv.Itoa(i+1)))
				return
			}
			if mint.TokenURI == "" {
				xhttp.Error(c, errcode.NewCustomErr("token_uri is required for mint #"+strconv.Itoa(i+1)))
				return
			}
		}

		// 调用批量铸造服务
		result, err := service.BatchMintMetaNodeNFT(c.Request.Context(), svcCtx, &req)
		if err != nil {
			xzap.WithContext(c).Error("failed to batch mint MetaNodeNFT", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Failed to batch mint NFT: "+err.Error()))
			return
		}

		xzap.WithContext(c).Info("MetaNodeNFT batch mint completed",
			zap.Int("success_count", result.SuccessCount),
			zap.Int("failed_count", result.FailedCount),
			zap.String("status", result.Status),
		)

		xhttp.OkJson(c, struct {
			Result *types.MetaNodeBatchMintResult `json:"result"`
		}{Result: result})
	}
}

// MetaNodeQueryHandler MetaNodeNFT查询接口
func MetaNodeQueryHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取查询参数
		chainIDStr := c.Query("chain_id")
		if chainIDStr == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id parameter is required"))
			return
		}

		chainID, err := strconv.Atoi(chainIDStr)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("Invalid chain_id parameter"))
			return
		}

		contractAddr := c.Query("contract_addr")
		tokenID := c.Query("token_id")
		owner := c.Query("owner")

		// 分页参数
		page := 1
		pageSize := 20

		if pageStr := c.Query("page"); pageStr != "" {
			if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
				page = p
			}
		}

		if sizeStr := c.Query("page_size"); sizeStr != "" {
			if s, err := strconv.Atoi(sizeStr); err == nil && s > 0 && s <= 100 {
				pageSize = s
			}
		}

		// 构建查询请求
		req := &types.MetaNodeQueryRequest{
			ChainID:      chainID,
			ContractAddr: contractAddr,
			TokenID:      tokenID,
			Owner:        owner,
			Page:         page,
			PageSize:     pageSize,
		}

		// 调用查询服务
		result, err := service.QueryMetaNodeNFT(c.Request.Context(), svcCtx, req)
		if err != nil {
			xzap.WithContext(c).Error("failed to query MetaNodeNFT", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Failed to query NFT: "+err.Error()))
			return
		}

		xhttp.OkJson(c, result)
	}
}

// MetaNodeContractInfoHandler MetaNodeNFT合约信息接口
func MetaNodeContractInfoHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取链ID参数
		chainIDStr := c.Query("chain_id")
		if chainIDStr == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id parameter is required"))
			return
		}

		chainID, err := strconv.Atoi(chainIDStr)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("Invalid chain_id parameter"))
			return
		}

		// 构建合约信息（这里是静态信息，实际项目中可以从区块链查询）
		contractInfo := &types.MetaNodeContractInfo{
			Address:     getContractAddress(svcCtx, chainID),
			Name:        "MetaNodeNFT",
			Symbol:      "MetaNode",
			Owner:       getContractOwner(svcCtx, chainID),
			TotalSupply: 0, // 需要从合约查询
			ChainID:     chainID,
		}

		xhttp.OkJson(c, struct {
			Result *types.MetaNodeContractInfo `json:"result"`
		}{Result: contractInfo})
	}
}

// MetaNodeTokenInfoHandler 获取特定Token信息接口
func MetaNodeTokenInfoHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取路径参数
		tokenID := c.Param("token_id")
		if tokenID == "" {
			xhttp.Error(c, errcode.NewCustomErr("token_id parameter is required"))
			return
		}

		// 获取查询参数
		chainIDStr := c.Query("chain_id")
		if chainIDStr == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id parameter is required"))
			return
		}

		chainID, err := strconv.Atoi(chainIDStr)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("Invalid chain_id parameter"))
			return
		}

		// 构建查询请求
		req := &types.MetaNodeQueryRequest{
			ChainID: chainID,
			TokenID: tokenID,
		}

		// 调用查询服务
		result, err := service.QueryMetaNodeNFT(c.Request.Context(), svcCtx, req)
		if err != nil {
			xzap.WithContext(c).Error("failed to query MetaNodeNFT token info", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Failed to query token info: "+err.Error()))
			return
		}

		if len(result.Tokens) == 0 {
			xhttp.Error(c, errcode.NewCustomErr("Token not found"))
			return
		}

		xhttp.OkJson(c, struct {
			Result *types.MetaNodeTokenInfo `json:"result"`
		}{Result: &result.Tokens[0]})
	}
}

// getContractAddress 根据链ID从配置文件获取合约地址
func getContractAddress(svcCtx *svc.ServerCtx, chainID int) string {
	if svcCtx.C.MetaNode == nil || svcCtx.C.MetaNode.ContractAddresses == nil {
		return "0x0000000000000000000000000000000000000000"
	}

	chainIDStr := fmt.Sprintf("%d", chainID)
	if addr, exists := svcCtx.C.MetaNode.ContractAddresses[chainIDStr]; exists {
		return addr
	}

	return "0x0000000000000000000000000000000000000000"
}

// getContractOwner 根据链ID获取合约所有者地址
func getContractOwner(svcCtx *svc.ServerCtx, chainID int) string {
	if svcCtx.C.MetaNode == nil || svcCtx.C.MetaNode.OwnerPrivateKey == "" {
		return "0x0000000000000000000000000000000000000000"
	}

	// 从私钥推导出地址（这里简化处理，实际应该用crypto包计算）
	// 注意：这里只是为了显示，实际生产中不应该暴露私钥对应的地址
	// 可以考虑在配置文件中单独配置所有者地址
	return "0x0000000000000000000000000000000000000000" // 可以从私钥计算得出
}
