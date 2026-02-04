package v1

import (
	"strconv"

	"github.com/ProjectsTask/EasySwapBase/errcode"
	"github.com/ProjectsTask/EasySwapBase/kit/validator"
	"github.com/ProjectsTask/EasySwapBase/xhttp"
	"github.com/gin-gonic/gin"

	"github.com/ProjectsTask/EasySwapBackend/src/service/svc"
	"github.com/ProjectsTask/EasySwapBackend/src/service/v1"
	"github.com/ProjectsTask/EasySwapBackend/src/types/v1"
)

// =================== NFT 合约管理 ===================

// AdminGetContractsHandler 获取合约列表
func AdminGetContractsHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		req := types.AdminGetContractsReq{
			Page:     1,
			PageSize: 20,
		}

		if err := c.ShouldBindQuery(&req); err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		if err := validator.Verify(&req); err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		res, err := service.AdminGetContracts(c.Request.Context(), svcCtx, req)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminGetContractHandler 获取单个合约详情
func AdminGetContractHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		chainIDStr := c.Param("chain_id")
		address := c.Param("address")

		if chainIDStr == "" || address == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id and address are required"))
			return
		}

		chainID, err := strconv.ParseInt(chainIDStr, 10, 64)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("invalid chain_id"))
			return
		}

		res, err := service.AdminGetContract(c.Request.Context(), svcCtx, chainID, address)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminAddContractHandler 添加合约地址
func AdminAddContractHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		req := types.AdminAddContractReq{}
		if err := c.BindJSON(&req); err != nil {
			xhttp.Error(c, err)
			return
		}

		if err := validator.Verify(&req); err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		res, err := service.AdminAddContract(c.Request.Context(), svcCtx, req)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminUpdateContractHandler 更新合约信息
func AdminUpdateContractHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		chainIDStr := c.Param("chain_id")
		address := c.Param("address")

		if chainIDStr == "" || address == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id and address are required"))
			return
		}

		chainID, err := strconv.ParseInt(chainIDStr, 10, 64)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("invalid chain_id"))
			return
		}

		req := types.AdminUpdateContractReq{}
		if err := c.BindJSON(&req); err != nil {
			xhttp.Error(c, err)
			return
		}

		res, err := service.AdminUpdateContractWithChainID(c.Request.Context(), svcCtx, chainID, address, req)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminDeleteContractHandler 删除合约地址
func AdminDeleteContractHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		chainIDStr := c.Param("chain_id")
		address := c.Param("address")

		if chainIDStr == "" || address == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id and address are required"))
			return
		}

		chainID, err := strconv.ParseInt(chainIDStr, 10, 64)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("invalid chain_id"))
			return
		}

		res, err := service.AdminDeleteContractWithChainID(c.Request.Context(), svcCtx, chainID, address)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminEnableContractHandler 启用合约
func AdminEnableContractHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		chainIDStr := c.Param("chain_id")
		address := c.Param("address")

		if chainIDStr == "" || address == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id and address are required"))
			return
		}

		chainID, err := strconv.ParseInt(chainIDStr, 10, 64)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("invalid chain_id"))
			return
		}

		res, err := service.AdminToggleContractWithChainID(c.Request.Context(), svcCtx, chainID, address, true)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminDisableContractHandler 禁用合约
func AdminDisableContractHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		chainIDStr := c.Param("chain_id")
		address := c.Param("address")

		if chainIDStr == "" || address == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id and address are required"))
			return
		}

		chainID, err := strconv.ParseInt(chainIDStr, 10, 64)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("invalid chain_id"))
			return
		}

		res, err := service.AdminToggleContractWithChainID(c.Request.Context(), svcCtx, chainID, address, false)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// =================== NFT 导入服务 ===================

// AdminSyncContractHandler 同步整个合约的 NFT
func AdminSyncContractHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		req := types.AdminSyncContractReq{}
		if err := c.BindJSON(&req); err != nil {
			xhttp.Error(c, err)
			return
		}

		if err := validator.Verify(&req); err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		res, err := service.AdminSyncContract(c.Request.Context(), svcCtx, req)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminSyncContractFromParamsHandler 通过路径参数同步合约
func AdminSyncContractFromParamsHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		chainIDStr := c.Param("chain_id")
		address := c.Param("address")

		if chainIDStr == "" || address == "" {
			xhttp.Error(c, errcode.NewCustomErr("chain_id and address are required"))
			return
		}

		chainID, err := strconv.ParseInt(chainIDStr, 10, 64)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr("invalid chain_id"))
			return
		}

		// 构建同步请求
		req := types.AdminSyncContractReq{
			ContractAddr: address,
			ChainID:      chainID,
		}

		res, err := service.AdminSyncContract(c.Request.Context(), svcCtx, req)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminSyncTokenHandler 同步指定 Token
func AdminSyncTokenHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		req := types.AdminSyncTokenReq{}
		if err := c.BindJSON(&req); err != nil {
			xhttp.Error(c, err)
			return
		}

		if err := validator.Verify(&req); err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		res, err := service.AdminSyncToken(c.Request.Context(), svcCtx, req)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminGetSyncStatusHandler 获取同步状态
func AdminGetSyncStatusHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		taskID := c.Param("task_id")
		if taskID == "" {
			xhttp.Error(c, errcode.NewCustomErr("task_id is required"))
			return
		}

		res, err := service.AdminGetSyncStatus(c.Request.Context(), svcCtx, taskID)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminGetSyncHistoryHandler 获取同步历史
func AdminGetSyncHistoryHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		req := types.AdminGetSyncHistoryReq{
			Page:     1,
			PageSize: 20,
		}

		if err := c.ShouldBindQuery(&req); err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		if err := validator.Verify(&req); err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		res, err := service.AdminGetSyncHistory(c.Request.Context(), svcCtx, req)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// =================== 系统管理 ===================

// AdminGetSystemStatsHandler 获取系统统计
func AdminGetSystemStatsHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		res, err := service.AdminGetSystemStats(c.Request.Context(), svcCtx)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}

// AdminRefreshMetadataHandler 批量刷新元数据
func AdminRefreshMetadataHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		req := types.AdminRefreshMetadataReq{}
		if err := c.BindJSON(&req); err != nil {
			xhttp.Error(c, err)
			return
		}

		if err := validator.Verify(&req); err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		res, err := service.AdminRefreshMetadata(c.Request.Context(), svcCtx, req)
		if err != nil {
			xhttp.Error(c, errcode.NewCustomErr(err.Error()))
			return
		}

		xhttp.OkJson(c, res)
	}
}
