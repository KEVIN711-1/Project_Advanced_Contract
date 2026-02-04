package v1

import (
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/ProjectsTask/EasySwapBase/errcode"
	"github.com/ProjectsTask/EasySwapBase/logger/xzap"
	"github.com/ProjectsTask/EasySwapBase/xhttp"

	"github.com/ProjectsTask/EasySwapBackend/src/api/middleware"
	"github.com/ProjectsTask/EasySwapBackend/src/service/svc"
	"github.com/ProjectsTask/EasySwapBackend/src/service/v1"
	"github.com/ProjectsTask/EasySwapBackend/src/types/v1"
)

// GetCOSTokenHandler 获取腾讯云COS临时访问凭证（免登录版本）
func GetCOSTokenHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 解析请求参数
		var req types.COSTokenRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			xzap.WithContext(c).Error("invalid request parameters", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Invalid request parameters"))
			return
		}

		// 验证文件类型
		validFileTypes := map[string]bool{
			"image":    true,
			"video":    true,
			"audio":    true,
			"document": true,
		}
		if !validFileTypes[req.FileType] {
			xhttp.Error(c, errcode.NewCustomErr("Invalid file type"))
			return
		}

		// 验证文件名
		if req.FileName == "" {
			xhttp.Error(c, errcode.NewCustomErr("File name is required"))
			return
		}

		// 验证文件大小
		if req.FileSize <= 0 {
			xhttp.Error(c, errcode.NewCustomErr("Invalid file size"))
			return
		}

		// 使用默认用户地址或生成匿名用户标识
		userAddr := "anonymous"
		if clientIP := c.ClientIP(); clientIP != "" {
			userAddr = "guest_" + clientIP
		}

		// 调用服务获取临时凭证
		result, err := service.GetCOSTemporaryToken(c.Request.Context(), svcCtx, userAddr, &req)
		if err != nil {
			xzap.WithContext(c).Error("failed to get COS temporary token", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Failed to get temporary token"))
			return
		}

		xhttp.OkJson(c, types.COSTokenResp{Result: result})
	}
}

// GetCOSUploadPolicyHandler 获取COS上传策略（备用接口）
func GetCOSUploadPolicyHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 验证用户身份
		address, err := middleware.GetAuthUserAddress(c, svcCtx.KvStore)
		if err != nil {
			xhttp.Error(c, err)
			return
		}

		// 获取文件类型参数
		fileType := c.Query("file_type")
		if fileType == "" {
			xhttp.Error(c, errcode.NewCustomErr("file_type parameter is required"))
			return
		}

		// 验证文件类型
		validFileTypes := map[string]bool{
			"image":    true,
			"video":    true,
			"audio":    true,
			"document": true,
		}
		if !validFileTypes[fileType] {
			xhttp.Error(c, errcode.NewCustomErr("Invalid file type"))
			return
		}

		// 获取上传策略
		policy, err := service.GetCOSUploadPolicy(c.Request.Context(), svcCtx, address[0], fileType)
		if err != nil {
			xzap.WithContext(c).Error("failed to get COS upload policy", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Failed to get upload policy"))
			return
		}

		xhttp.OkJson(c, struct {
			Result interface{} `json:"result"`
		}{Result: policy})
	}
}

// COSCallbackHandler COS上传回调处理（可选）
func COSCallbackHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 验证用户身份
		address, err := middleware.GetAuthUserAddress(c, svcCtx.KvStore)
		if err != nil {
			xhttp.Error(c, err)
			return
		}

		// 解析上传结果
		var uploadResult types.COSUploadResult
		if err := c.ShouldBindJSON(&uploadResult); err != nil {
			xzap.WithContext(c).Error("invalid upload result", zap.Error(err))
			xhttp.Error(c, errcode.NewCustomErr("Invalid upload result"))
			return
		}

		// 记录上传成功的文件信息
		xzap.WithContext(c).Info("file uploaded successfully",
			zap.String("user", address[0]),
			zap.String("key", uploadResult.Key),
			zap.String("location", uploadResult.Location),
			zap.String("bucket", uploadResult.Bucket),
		)

		// 这里可以添加业务逻辑，比如：
		// 1. 将文件信息保存到数据库
		// 2. 生成缩略图
		// 3. 进行内容审核
		// 4. 更新用户资产信息

		xhttp.OkJson(c, struct {
			Result string `json:"result"`
		}{Result: "Upload callback processed successfully"})
	}
}
