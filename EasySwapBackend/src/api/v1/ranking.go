package v1

import (
	"sort"
	"strconv"
	"sync"

	"github.com/ProjectsTask/EasySwapBase/errcode"
	"github.com/ProjectsTask/EasySwapBase/logger/xzap"
	"github.com/ProjectsTask/EasySwapBase/xhttp"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/ProjectsTask/EasySwapBackend/src/service/svc"
	"github.com/ProjectsTask/EasySwapBackend/src/service/v1"
	"github.com/ProjectsTask/EasySwapBackend/src/types/v1"
)

func TopRankingHandler(svcCtx *svc.ServerCtx) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit, err := strconv.ParseInt(c.Query("limit"), 10, 64)
		if err != nil {
			xhttp.Error(c, errcode.ErrInvalidParams)
			return
		}

		period := c.Query("range")
		if period != "" {
			validParams := map[string]bool{
				"15m": true,
				"1h":  true,
				"6h":  true,
				"1d":  true,
				"7d":  true,
				"30d": true,
			}
			if ok := validParams[period]; !ok {
				xzap.WithContext(c).Error("range parse error: ", zap.String("range", period))
				xhttp.Error(c, errcode.ErrInvalidParams)
				return
			}
		} else {
			period = "1d"
		}

		var allResult []*types.CollectionRankingInfo

		var wg sync.WaitGroup
		var mu sync.Mutex

		for _, chain := range svcCtx.C.ChainSupported {
			wg.Add(1)
			go func(chain string) {
				defer wg.Done()

				result, err := service.GetTopRanking(c.Copy(), svcCtx, chain, period, limit)
				if err != nil {
					xhttp.Error(c, err)
					return
				}

				mu.Lock()
				allResult = append(allResult, result...)
				mu.Unlock()
			}(chain.Name)
		}

		wg.Wait()
		// Sort the collections slice based on the Volume in descending order
		sort.SliceStable(allResult, func(i, j int) bool {
			return allResult[i].Volume.GreaterThan(allResult[j].Volume)
		})

		xhttp.OkJson(c, types.CollectionRankingResp{Result: allResult})
	}
}
